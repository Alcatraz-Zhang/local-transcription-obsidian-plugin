from __future__ import annotations

import os
import signal
import subprocess
import threading
import time
from collections.abc import Callable, Sequence
from typing import Protocol


class ManagedProcess(Protocol):
    pid: int
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
        child_exit_grace: float = 5,
        managed_shutdown_signal: int | signal.Signals | None = None,
    ) -> None:
        self.command = list(command)
        self.ready_check = ready_check
        self.popen = popen or self._default_popen
        self.now = now
        self.idle_timeout = idle_timeout
        self.stop_grace = stop_grace
        self.child_exit_grace = child_exit_grace
        self.managed_shutdown_signal = managed_shutdown_signal
        self._process: ManagedProcess | None = None
        self._active_tasks = 0
        self._last_activity = now()
        self._lock = threading.Lock()

    @staticmethod
    def _default_popen(command: Sequence[str]) -> ManagedProcess:
        kwargs: dict[str, object] = {}
        if os.name == "nt":
            kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
        else:
            kwargs["start_new_session"] = True
        return subprocess.Popen(list(command), **kwargs)

    def _terminate_process_tree(self, process: ManagedProcess) -> None:
        if process.poll() is not None:
            return

        process_group_id: int | None = None
        if os.name != "nt":
            try:
                process_group_id = os.getpgid(process.pid)
            except ProcessLookupError:
                return
            except Exception:
                process_group_id = None

        if process_group_id is not None:
            try:
                if self.managed_shutdown_signal is not None:
                    os.kill(process.pid, self.managed_shutdown_signal)
                os.kill(process.pid, signal.SIGINT)
            except ProcessLookupError:
                return
            except Exception:
                process.terminate()
        else:
            process.terminate()
        if self._wait_for_process_exit(process):
            if process_group_id is not None:
                if self._wait_for_process_group_exit(process_group_id):
                    return
                self._terminate_process_group(process_group_id, signal.SIGTERM)
            return

        if process_group_id is not None:
            if self._terminate_process_group(process_group_id, signal.SIGTERM):
                if self._wait_for_process_exit(process):
                    return

        if process_group_id is not None:
            if self._terminate_process_group(process_group_id, signal.SIGKILL):
                if self._wait_for_process_exit(process):
                    return
            else:
                return

        process.kill()
        process.wait(timeout=self.stop_grace)

    def _wait_for_process_exit(self, process: ManagedProcess) -> bool:
        try:
            process.wait(timeout=self.stop_grace)
            return True
        except subprocess.TimeoutExpired:
            return False

    def _process_group_exists(self, process_group_id: int) -> bool:
        try:
            os.killpg(process_group_id, 0)
            return True
        except ProcessLookupError:
            return False
        except Exception:
            return True

    def _wait_for_process_group_exit(self, process_group_id: int) -> bool:
        deadline = self.now() + self.child_exit_grace
        while True:
            if not self._process_group_exists(process_group_id):
                return True
            if self.now() >= deadline:
                return False
            time.sleep(min(0.2, max(0, deadline - self.now())))

    def _terminate_process_group(self, process_group_id: int, sig: signal.Signals) -> bool:
        try:
            os.killpg(process_group_id, sig)
            return True
        except ProcessLookupError:
            return False
        except Exception:
            return True

    @property
    def running(self) -> bool:
        return self._process is not None and self._process.poll() is None

    @property
    def process_returncode(self) -> int | None:
        with self._lock:
            process = self._process
        if process is None:
            return None
        return process.poll()

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
        try:
            ready = self.ready_check()
        except Exception:
            with self._lock:
                process = self._process
                self._process = None
            if process is not None:
                self._terminate_process_tree(process)
            raise
        if not ready:
            with self._lock:
                process = self._process
                self._process = None
            if process is not None:
                self._terminate_process_tree(process)
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
        self._terminate_process_tree(process)
        return True
