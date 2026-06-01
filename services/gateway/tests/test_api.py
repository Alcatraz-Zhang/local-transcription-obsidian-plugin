from pathlib import Path

from fastapi.testclient import TestClient

from gateway_app.main import create_app


class FakeBackend:
    def __init__(self):
        self.calls = []

    def transcribe(self, audio_path: Path, *, language=None, model=None, output_mode="speaker_timestamp"):
        self.calls.append(
            {
                "audio_path": audio_path,
                "language": language,
                "model": model,
                "output_mode": output_mode,
            }
        )
        return {
            "text": "大家好。",
            "segments": [
                {"speaker_id": "Speaker1", "start_time": 0, "end_time": 1, "text": "大家好。"}
            ],
        }


class FakeLifecycle:
    running = True
    active_tasks = 0

    def __init__(self):
        self.stop_calls = 0

    def stop_if_idle(self):
        self.stop_calls += 1
        self.running = False
        return True


class FakeLifecycleBackend(FakeBackend):
    def __init__(self):
        super().__init__()
        self.lifecycle = FakeLifecycle()


def test_jobs_endpoint_saves_audio_and_returns_completed_job(tmp_path):
    backend = FakeBackend()
    app = create_app(backend=backend, storage_root=tmp_path, run_jobs_inline=True)
    client = TestClient(app)

    response = client.post(
        "/jobs",
        files={"file": ("meeting.wav", b"audio-bytes", "audio/wav")},
        data={"language": "zh", "output_mode": "speaker_timestamp"},
    )

    assert response.status_code == 200
    job = response.json()
    assert job["status"] == "completed"
    assert job["result"]["segments"][0] == {
        "start": 0.0,
        "end": 1.0,
        "speaker": "Speaker1",
        "text": "大家好。",
    }
    assert job["result"]["text"] == "大家好。"
    assert job["result"]["sentence_info"][0] == job["result"]["segments"][0]
    assert Path(job["audio_path"]).exists()
    assert backend.calls[0]["language"] == "zh"


def test_openai_endpoint_returns_structured_segments(tmp_path):
    backend = FakeBackend()
    app = create_app(backend=backend, storage_root=tmp_path, run_jobs_inline=True)
    client = TestClient(app)

    response = client.post(
        "/v1/audio/transcriptions",
        files={"file": ("meeting.wav", b"audio-bytes", "audio/wav")},
        data={"response_format": "json"},
    )

    assert response.status_code == 200
    assert response.json()["text"] == "大家好。"
    assert response.json()["segments"][0]["speaker"] == "Speaker1"
    assert response.json()["sentence_info"][0]["speaker"] == "Speaker1"


def test_health_reports_runtime_configuration(tmp_path):
    backend = FakeBackend()
    app = create_app(backend=backend, storage_root=tmp_path, run_jobs_inline=True, idle_timeout=123)
    client = TestClient(app)

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["idle_timeout_seconds"] == 123


def test_health_triggers_idle_backend_stop(tmp_path):
    backend = FakeLifecycleBackend()
    app = create_app(backend=backend, storage_root=tmp_path, run_jobs_inline=True, idle_timeout=123)
    client = TestClient(app)

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["backend_running"] is False
    assert backend.lifecycle.stop_calls == 1
