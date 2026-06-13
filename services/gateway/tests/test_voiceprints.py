import sqlite3

import httpx
from fastapi.testclient import TestClient

from gateway_app.main import create_app


class FakeVoiceprintBackend:
    backend_url = "http://qwen.local"

    def __init__(self):
        self.ready_calls = 0
        self.requests = []

    def ensure_ready(self):
        self.ready_calls += 1

    def upstream_request(self, method, path, **kwargs):
        self.ensure_ready()
        self.requests.append({"method": method, "path": path, "kwargs": kwargs})
        if path == "/api/v1/voiceprint-speakers" and method == "GET":
            return httpx.Response(200, json={"speakers": [{"speaker_id": "vp_1", "display_name": "Alice"}]})
        if path == "/api/v1/voiceprint-speakers" and method == "POST":
            return httpx.Response(200, json={"speaker_id": "vp_1", "display_name": "Alice", "voiceprint_count": 1})
        if path == "/api/v1/voiceprint-speakers/vp_1/samples" and method == "POST":
            return httpx.Response(200, json={"speaker_id": "vp_1", "voiceprint_count": 2})
        if path == "/api/v1/voiceprint-speakers/vp_1" and method == "DELETE":
            return httpx.Response(200, json={"speaker_id": "vp_1", "deleted": True})
        return httpx.Response(404, json={"message": "not found"})


def test_voiceprint_speaker_list_proxies_to_upstream(tmp_path):
    backend = FakeVoiceprintBackend()
    app = create_app(backend=backend, storage_root=tmp_path, run_jobs_inline=True)
    client = TestClient(app)

    response = client.get("/voiceprints/speakers")

    assert response.status_code == 200
    assert response.json()["speakers"][0]["display_name"] == "Alice"
    assert backend.ready_calls == 1
    assert backend.requests[0]["method"] == "GET"
    assert backend.requests[0]["path"] == "/api/v1/voiceprint-speakers"


def test_voiceprint_create_speaker_forwards_form_and_file(tmp_path):
    backend = FakeVoiceprintBackend()
    app = create_app(backend=backend, storage_root=tmp_path, run_jobs_inline=True)
    client = TestClient(app)

    response = client.post(
        "/voiceprints/speakers",
        data={"display_name": "Alice", "description": "PM"},
        files={"file": ("alice.wav", b"audio-bytes", "audio/wav")},
    )

    assert response.status_code == 200
    assert response.json()["speaker_id"] == "vp_1"
    request = backend.requests[0]
    assert request["method"] == "POST"
    assert request["path"] == "/api/v1/voiceprint-speakers"
    assert request["kwargs"]["data"]["display_name"] == "Alice"
    assert request["kwargs"]["data"]["description"] == "PM"
    assert request["kwargs"]["files"][0][0] == "file"


def test_voiceprint_add_sample_forwards_to_existing_speaker(tmp_path):
    backend = FakeVoiceprintBackend()
    app = create_app(backend=backend, storage_root=tmp_path, run_jobs_inline=True)
    client = TestClient(app)

    response = client.post(
        "/voiceprints/speakers/vp_1/samples",
        files={"file": ("alice2.wav", b"audio-bytes", "audio/wav")},
    )

    assert response.status_code == 200
    assert response.json()["voiceprint_count"] == 2
    assert backend.requests[0]["path"] == "/api/v1/voiceprint-speakers/vp_1/samples"


def test_voiceprint_delete_speaker_forwards_to_upstream(tmp_path):
    backend = FakeVoiceprintBackend()
    app = create_app(backend=backend, storage_root=tmp_path, run_jobs_inline=True)
    client = TestClient(app)

    response = client.delete("/voiceprints/speakers/vp_1")

    assert response.status_code == 200
    assert response.json()["deleted"] is True
    assert backend.requests[0]["path"] == "/api/v1/voiceprint-speakers/vp_1"


def test_voiceprint_health_reports_configuration_without_starting_backend(tmp_path, monkeypatch):
    monkeypatch.setenv("VOICEPRINT_ENABLED", "true")
    monkeypatch.setenv("VOICEPRINT_DB_PATH", "/data/voiceprints.sqlite3")
    monkeypatch.setenv("VOICEPRINT_MATCH_THRESHOLD", "0.72")
    backend = FakeVoiceprintBackend()
    app = create_app(backend=backend, storage_root=tmp_path, run_jobs_inline=True)
    client = TestClient(app)

    response = client.get("/voiceprints/health")

    assert response.status_code == 200
    assert response.json() == {
        "enabled": True,
        "db_path": "/data/voiceprints.sqlite3",
        "db_exists": False,
        "db_size_bytes": 0,
        "match_threshold": 0.72,
        "speaker_count": None,
    }
    assert backend.ready_calls == 0


def test_voiceprint_health_counts_existing_sqlite_speakers_without_starting_backend(tmp_path, monkeypatch):
    db_path = tmp_path / "voiceprints.sqlite3"
    with sqlite3.connect(db_path) as connection:
        connection.execute(
            "create table voiceprint_speakers (speaker_id text primary key, display_name text, status text, deleted_at text)"
        )
        connection.execute(
            "insert into voiceprint_speakers (speaker_id, display_name, status, deleted_at) values (?, ?, ?, ?)",
            ("vp_alice", "Alice", "active", None),
        )
        connection.execute(
            "insert into voiceprint_speakers (speaker_id, display_name, status, deleted_at) values (?, ?, ?, ?)",
            ("vp_deleted", "Deleted", "active", "2026-06-12T00:00:00Z"),
        )
        connection.execute(
            "insert into voiceprint_speakers (speaker_id, display_name, status, deleted_at) values (?, ?, ?, ?)",
            ("vp_status_deleted", "Status Deleted", "deleted", None),
        )

    monkeypatch.setenv("VOICEPRINT_ENABLED", "true")
    monkeypatch.setenv("VOICEPRINT_DB_PATH", str(db_path))
    backend = FakeVoiceprintBackend()
    app = create_app(backend=backend, storage_root=tmp_path, run_jobs_inline=True)
    client = TestClient(app)

    response = client.get("/voiceprints/health")

    assert response.status_code == 200
    assert response.json()["db_exists"] is True
    assert response.json()["db_size_bytes"] > 0
    assert response.json()["speaker_count"] == 1
    assert backend.ready_calls == 0


def test_voiceprint_disabled_returns_503(tmp_path, monkeypatch):
    monkeypatch.setenv("VOICEPRINT_ENABLED", "false")
    backend = FakeVoiceprintBackend()
    app = create_app(backend=backend, storage_root=tmp_path, run_jobs_inline=True)
    client = TestClient(app)

    response = client.get("/voiceprints/speakers")

    assert response.status_code == 503
    assert "disabled" in response.json()["message"].lower()
    assert backend.ready_calls == 0


def test_voiceprint_upstream_failure_returns_502(tmp_path):
    class BrokenBackend(FakeVoiceprintBackend):
        def upstream_request(self, method, path, **kwargs):
            return httpx.Response(500, json={"message": "upstream failed"})

    app = create_app(backend=BrokenBackend(), storage_root=tmp_path, run_jobs_inline=True)
    client = TestClient(app)

    response = client.get("/voiceprints/speakers")

    assert response.status_code == 502
    assert "upstream failed" in response.json()["message"]


def test_voiceprint_backend_start_failure_returns_502(tmp_path):
    class FailingBackend(FakeVoiceprintBackend):
        def upstream_request(self, method, path, **kwargs):
            raise RuntimeError("ASR backend exited before becoming ready (exit code 3)")

    app = create_app(backend=FailingBackend(), storage_root=tmp_path, run_jobs_inline=True)
    client = TestClient(app)

    response = client.get("/voiceprints/speakers")

    assert response.status_code == 502
    assert "backend is unavailable" in response.json()["message"]
    assert "exit code 3" in response.json()["message"]
