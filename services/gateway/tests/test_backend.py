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
