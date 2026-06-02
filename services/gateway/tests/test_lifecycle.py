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


def test_lifecycle_terminates_process_group_on_posix(monkeypatch):
    process = FakeProcess()
    signals = []

    def fake_killpg(process_group_id, sig):
        signals.append((process_group_id, sig))
        process.returncode = 0

    monkeypatch.setattr(lifecycle_module.os, "name", "posix")
    monkeypatch.setattr(lifecycle_module.os, "getpgid", lambda pid: 4321, raising=False)
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
    assert signals == [(4321, lifecycle_module.signal.SIGTERM)]
    assert process.terminated is False
    assert process.killed is False
