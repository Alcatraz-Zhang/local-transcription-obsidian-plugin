import subprocess
import time

from gateway_app import lifecycle as lifecycle_module
from gateway_app.lifecycle import BackendLifecycle


class FakeProcess:
    def __init__(self):
        self.terminated = False
        self.killed = False
        self.returncode = None
        self.pid = 1234

    def poll(self):
        return self.returncode

    def terminate(self):
        self.terminated = True
        self.returncode = 0

    def kill(self):
        self.killed = True
        self.returncode = -9

    def wait(self, timeout=None):
        return self.returncode


class SlowProcess(FakeProcess):
    def terminate(self):
        self.terminated = True

    def wait(self, timeout=None):
        if self.returncode is None:
            raise subprocess.TimeoutExpired(cmd=["fake"], timeout=timeout)
        return self.returncode


def test_lifecycle_starts_once_and_stops_after_idle():
    processes = []

    lifecycle = BackendLifecycle(
        command=["fake"],
        ready_check=lambda: True,
        popen=lambda command: processes.append(FakeProcess()) or processes[-1],
        now=time.monotonic,
        idle_timeout=0.01,
    )

    lifecycle.ensure_ready()
    lifecycle.ensure_ready()
    assert len(processes) == 1

    lifecycle.mark_activity_finished()
    time.sleep(0.02)
    assert lifecycle.stop_if_idle() is True
    assert processes[0].terminated is True


def test_lifecycle_does_not_stop_while_active():
    processes = []
    lifecycle = BackendLifecycle(
        command=["fake"],
        ready_check=lambda: True,
        popen=lambda command: processes.append(FakeProcess()) or processes[-1],
        now=time.monotonic,
        idle_timeout=0,
    )

    lifecycle.mark_activity_started()
    lifecycle.ensure_ready()

    assert lifecycle.stop_if_idle() is False
    assert processes[0].terminated is False


def test_lifecycle_terminates_process_when_ready_check_fails():
    processes = []
    lifecycle = BackendLifecycle(
        command=["fake"],
        ready_check=lambda: False,
        popen=lambda command: processes.append(FakeProcess()) or processes[-1],
        now=time.monotonic,
        idle_timeout=300,
    )

    try:
        lifecycle.ensure_ready()
    except RuntimeError:
        pass
    else:
        raise AssertionError("ensure_ready should raise when backend is not ready")

    assert processes[0].terminated is True
    assert lifecycle.running is False


def test_lifecycle_terminates_parent_then_process_group_on_posix(monkeypatch):
    process = FakeProcess()
    parent_signals = []
    signals = []
    group_alive_checks = []

    def fake_kill(pid, sig):
        parent_signals.append((pid, sig))
        process.returncode = 0

    def fake_killpg_check(process_group_id, sig):
        if sig == 0:
            group_alive_checks.append(process_group_id)
            raise ProcessLookupError
        signals.append((process_group_id, sig))

    def fake_killpg(process_group_id, sig):
        fake_killpg_check(process_group_id, sig)

    monkeypatch.setattr(lifecycle_module.os, "name", "posix")
    monkeypatch.setattr(lifecycle_module.os, "getpgid", lambda pid: 4321, raising=False)
    monkeypatch.setattr(lifecycle_module.os, "kill", fake_kill, raising=False)
    monkeypatch.setattr(lifecycle_module.os, "killpg", fake_killpg, raising=False)

    lifecycle = BackendLifecycle(
        command=["fake"],
        ready_check=lambda: True,
        popen=lambda command: process,
        now=time.monotonic,
        idle_timeout=0,
    )

    lifecycle.ensure_ready()

    assert lifecycle.stop_if_idle() is True
    assert parent_signals == [(1234, lifecycle_module.signal.SIGINT)]
    assert group_alive_checks == [4321]
    assert signals == []
    assert process.terminated is False
    assert process.killed is False


def test_lifecycle_escalates_after_parent_exits_but_group_survives(monkeypatch):
    process = FakeProcess()
    parent_signals = []
    signals = []

    def fake_kill(pid, sig):
        parent_signals.append((pid, sig))
        process.returncode = 0

    def fake_killpg(process_group_id, sig):
        signals.append((process_group_id, sig))
        if sig == lifecycle_module.signal.SIGTERM:
            raise ProcessLookupError

    monkeypatch.setattr(lifecycle_module.os, "name", "posix")
    monkeypatch.setattr(lifecycle_module.os, "getpgid", lambda pid: 4321, raising=False)
    monkeypatch.setattr(lifecycle_module.os, "kill", fake_kill, raising=False)
    monkeypatch.setattr(lifecycle_module.os, "killpg", fake_killpg, raising=False)
    monkeypatch.setattr(lifecycle_module.time, "sleep", lambda seconds: None)

    lifecycle = BackendLifecycle(
        command=["fake"],
        ready_check=lambda: True,
        popen=lambda command: process,
        now=time.monotonic,
        idle_timeout=0,
        child_exit_grace=0,
    )

    lifecycle.ensure_ready()

    assert lifecycle.stop_if_idle() is True
    assert parent_signals == [(1234, lifecycle_module.signal.SIGINT)]
    assert signals == [
        (4321, 0),
        (4321, lifecycle_module.signal.SIGTERM),
    ]
    assert process.terminated is False
    assert process.killed is False


def test_lifecycle_sends_managed_shutdown_signal_before_sigint_on_posix(monkeypatch):
    process = FakeProcess()
    parent_signals = []

    def fake_kill(pid, sig):
        parent_signals.append((pid, sig))
        if sig == lifecycle_module.signal.SIGINT:
            process.returncode = 0

    def fake_killpg(process_group_id, sig):
        if sig == 0:
            raise ProcessLookupError

    monkeypatch.setattr(lifecycle_module.os, "name", "posix")
    monkeypatch.setattr(lifecycle_module.os, "getpgid", lambda pid: 4321, raising=False)
    monkeypatch.setattr(lifecycle_module.os, "kill", fake_kill, raising=False)
    monkeypatch.setattr(lifecycle_module.os, "killpg", fake_killpg, raising=False)

    lifecycle = BackendLifecycle(
        command=["fake"],
        ready_check=lambda: True,
        popen=lambda command: process,
        now=time.monotonic,
        idle_timeout=0,
        managed_shutdown_signal=10,
    )

    lifecycle.ensure_ready()

    assert lifecycle.stop_if_idle() is True
    assert parent_signals == [
        (1234, 10),
        (1234, lifecycle_module.signal.SIGINT),
    ]


def test_lifecycle_escalates_to_process_group_when_parent_does_not_exit(monkeypatch):
    process = SlowProcess()
    parent_signals = []
    signals = []

    def fake_kill(pid, sig):
        parent_signals.append((pid, sig))

    def fake_killpg(process_group_id, sig):
        signals.append((process_group_id, sig))
        process.returncode = -15

    monkeypatch.setattr(lifecycle_module.os, "name", "posix")
    monkeypatch.setattr(lifecycle_module.os, "getpgid", lambda pid: 4321, raising=False)
    monkeypatch.setattr(lifecycle_module.os, "kill", fake_kill, raising=False)
    monkeypatch.setattr(lifecycle_module.os, "killpg", fake_killpg, raising=False)

    lifecycle = BackendLifecycle(
        command=["fake"],
        ready_check=lambda: True,
        popen=lambda command: process,
        now=time.monotonic,
        idle_timeout=0,
    )

    lifecycle.ensure_ready()

    assert lifecycle.stop_if_idle() is True
    assert parent_signals == [(1234, lifecycle_module.signal.SIGINT)]
    assert process.terminated is False
    assert signals == [(4321, lifecycle_module.signal.SIGTERM)]
    assert process.killed is False
