from __future__ import annotations

import subprocess
import threading
import time
from collections.abc import Callable, Sequence
from typing import Protocol


class ManagedProcess(Protocol):
    returncode: int | None

    def poll(self) -> int | None: ...

    def terminate(self) -> None: ...

    def kill(self) -> None: ...

    def wait(self, timeout: float | None = None) -> int | None: ...


class BackendLifecycle:
    def __init__(
        self,
        *,
        command: Sequence[str],
        ready_check: Callable[[], bool],
        popen: Callable[[Sequence[str]], ManagedProcess] | None = None,
        now: Callable[[], float] = time.monotonic,
        idle_timeout: float = 300,
        stop_grace: float = 10,
    ) -> None:
        self.command = list(command)
        self.ready_check = ready_check
        self.popen = popen or self._default_popen
        self.now = now
        self.idle_timeout = idle_timeout
        self.stop_grace = stop_grace
        self._process: ManagedProcess | None = None
        self._active_tasks = 0
        self._last_activity = now()
        self._lock = threading.Lock()

    @staticmethod
    def _default_popen(command: Sequence[str]) -> ManagedProcess:
        return subprocess.Popen(list(command))

    @property
    def running(self) -> bool:
        return self._process is not None and self._process.poll() is None

    @property
    def active_tasks(self) -> int:
        with self._lock:
            return self._active_tasks

    def mark_activity_started(self) -> None:
        with self._lock:
            self._active_tasks += 1
            self._last_activity = self.now()

    def mark_activity_finished(self) -> None:
        with self._lock:
            self._active_tasks = max(0, self._active_tasks - 1)
            self._last_activity = self.now()

    def ensure_ready(self) -> None:
        with self._lock:
            if not self.running:
                self._process = self.popen(self.command)
            self._last_activity = self.now()
        if not self.ready_check():
            raise RuntimeError("ASR backend failed to become ready")

    def stop_if_idle(self) -> bool:
        with self._lock:
            if self._active_tasks > 0 or not self.running:
                return False
            if self.now() - self._last_activity < self.idle_timeout:
                return False
            process = self._process
            self._process = None

        assert process is not None
        process.terminate()
        try:
            process.wait(timeout=self.stop_grace)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=self.stop_grace)
        return True

