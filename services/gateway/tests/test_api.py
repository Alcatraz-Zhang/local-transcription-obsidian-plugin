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
    assert job["result"]["text"] == "[00:00:00 - 00:00:01] Speaker1: 大家好。\n"
    assert Path(job["audio_path"]).exists()
    assert backend.calls[0]["language"] == "zh"


def test_openai_endpoint_returns_timestamped_text(tmp_path):
    backend = FakeBackend()
    app = create_app(backend=backend, storage_root=tmp_path, run_jobs_inline=True)
    client = TestClient(app)

    response = client.post(
        "/v1/audio/transcriptions",
        files={"file": ("meeting.wav", b"audio-bytes", "audio/wav")},
        data={"response_format": "json"},
    )

    assert response.status_code == 200
    assert response.json()["text"] == "[00:00:00 - 00:00:01] Speaker1: 大家好。\n"
    assert response.json()["segments"][0]["speaker"] == "Speaker1"
