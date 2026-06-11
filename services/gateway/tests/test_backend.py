import pytest

from gateway_app import backend as backend_module
from gateway_app.backend import BackendConfig, QwenBackend


def test_backend_config_reads_user_facing_env_defaults(monkeypatch):
    monkeypatch.setenv("ASR_MODEL", "qwen3-asr-0.6b")
    monkeypatch.setenv("LANGUAGE", "zh")
    monkeypatch.setenv("ENABLE_DIARIZATION", "false")
    monkeypatch.setenv("ENABLE_TIMESTAMPS", "false")
    monkeypatch.setenv("IDLE_TIMEOUT", "77")
    monkeypatch.setenv("ASR_READY_TIMEOUT", "1888")

    config = BackendConfig.from_env()

    assert config.asr_model == "qwen3-asr-0.6b"
    assert config.language == "zh"
    assert config.enable_diarization is False
    assert config.enable_timestamps is False
    assert config.idle_timeout == 77
    assert config.ready_timeout == 1888


def test_backend_config_builds_transcription_form_with_request_overrides(monkeypatch):
    monkeypatch.setenv("ASR_MODEL", "qwen3-asr-0.6b")
    monkeypatch.setenv("LANGUAGE", "zh")
    monkeypatch.setenv("ENABLE_DIARIZATION", "true")
    monkeypatch.setenv("ENABLE_TIMESTAMPS", "true")
    config = BackendConfig.from_env()

    data = config.transcription_form(language="en", model="auto")

    assert data["language"] == "en"
    assert data["model"] == "qwen3-asr-0.6b"
    assert data["enable_speaker_diarization"] == "true"
    assert data["response_format"] == "verbose_json"


def test_qwen_backend_starts_wrapped_child_entrypoint():
    backend = QwenBackend()

    assert backend.lifecycle.command == ["/opt/venv/bin/python", "-m", "gateway_app.qwen_child"]


def test_qwen_backend_exposes_upstream_proxy_helpers():
    backend = QwenBackend()

    assert callable(backend.ensure_ready)
    assert callable(backend.upstream_request)


class ExitedProcess:
    pid = 1234
    returncode = 17

    def poll(self):
        return self.returncode

    def terminate(self):
        raise AssertionError("exited process should not need terminate")

    def kill(self):
        raise AssertionError("exited process should not need kill")

    def wait(self, timeout=None):
        return self.returncode


class UnreadyClient:
    def __init__(self, *args, **kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def get(self, url):
        raise backend_module.httpx.HTTPError("not ready")


def test_qwen_backend_stops_waiting_when_child_process_exits(monkeypatch):
    backend = QwenBackend(config=BackendConfig(ready_timeout=60), ready_timeout=60)
    backend.lifecycle.popen = lambda command: ExitedProcess()
    monkeypatch.setattr(backend_module.httpx, "Client", UnreadyClient)

    def fail_sleep(seconds):
        raise AssertionError("waited for readiness after child process exited")

    monkeypatch.setattr(backend_module.time, "sleep", fail_sleep)

    with pytest.raises(RuntimeError, match="ASR backend exited before becoming ready"):
        backend.ensure_ready()
