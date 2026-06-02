from __future__ import annotations

import shutil
import threading
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .backend import QwenBackend
from .formatter import normalize_response
from .voiceprints import create_voiceprint_router


def _safe_filename(value: str, default: str = "audio") -> str:
    cleaned = "".join("-" if char in '<>:"/\\|?*\n\r\t' else char for char in value.strip())
    cleaned = " ".join(cleaned.split()).strip(" .")
    return cleaned or default


def _unique_path(directory: Path, filename: str) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    candidate = directory / filename
    if not candidate.exists():
        return candidate
    for index in range(2, 1000):
        candidate = directory / f"{Path(filename).stem}-{index}{Path(filename).suffix}"
        if not candidate.exists():
            return candidate
    raise RuntimeError(f"Could not find a free filename for {filename}")


def create_app(
    *,
    backend: Any | None = None,
    storage_root: Path | None = None,
    run_jobs_inline: bool = False,
    idle_timeout: int | None = None,
    idle_check_interval: float = 5.0,
) -> FastAPI:
    root = storage_root or Path("/data")
    audio_dir = root / "audio"
    backend = backend or QwenBackend()
    jobs: dict[str, dict[str, Any]] = {}
    stop_idle_monitor = threading.Event()

    def stop_backend_if_idle() -> bool:
        lifecycle = getattr(backend, "lifecycle", None)
        stop_if_idle = getattr(lifecycle, "stop_if_idle", None)
        if not callable(stop_if_idle):
            return False
        return bool(stop_if_idle())

    def idle_monitor() -> None:
        while not stop_idle_monitor.wait(idle_check_interval):
            stop_backend_if_idle()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if getattr(backend, "lifecycle", None) is None:
            yield
            return
        thread = threading.Thread(target=idle_monitor, daemon=True)
        thread.start()
        app.state.idle_monitor_thread = thread
        try:
            yield
        finally:
            stop_idle_monitor.set()

    app = FastAPI(title="Obsidian Local ASR Gateway", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(create_voiceprint_router(backend))

    def process_job(job_id: str) -> None:
        job = jobs[job_id]
        job["status"] = "running"
        job["updated_at"] = datetime.now().isoformat(timespec="seconds")
        try:
            payload = backend.transcribe(
                Path(job["audio_path"]),
                language=job.get("language"),
                model=job.get("model"),
                output_mode=job.get("output_mode", "speaker_timestamp"),
            )
            job["result"] = normalize_response(payload)
            job["status"] = "completed"
            job["error"] = None
        except Exception as exc:
            job["status"] = "failed"
            job["error"] = str(exc)
        finally:
            job["updated_at"] = datetime.now().isoformat(timespec="seconds")

    def start_job(job_id: str) -> None:
        if run_jobs_inline:
            process_job(job_id)
        else:
            threading.Thread(target=process_job, args=(job_id,), daemon=True).start()

    @app.get("/health")
    async def health() -> dict[str, Any]:
        stop_backend_if_idle()
        lifecycle = getattr(backend, "lifecycle", None)
        backend_config = getattr(backend, "config", None)
        return {
            "status": "ok",
            "backend_running": bool(getattr(lifecycle, "running", False)),
            "active_tasks": int(getattr(lifecycle, "active_tasks", 0)),
            "queued_jobs": sum(1 for job in jobs.values() if job["status"] in {"queued", "running"}),
            "idle_timeout_seconds": idle_timeout
            if idle_timeout is not None
            else int(getattr(backend_config, "idle_timeout", 0) or 0),
        }

    @app.post("/jobs")
    async def create_job(
        file: UploadFile = File(...),
        language: str = Form("auto"),
        model: str = Form("auto"),
    ) -> JSONResponse:
        source_name = _safe_filename(file.filename or "audio.wav")
        timestamp = datetime.now().strftime("%Y-%m-%d %H-%M-%S")
        audio_path = _unique_path(audio_dir, f"{timestamp} - {source_name}")
        with audio_path.open("wb") as handle:
            shutil.copyfileobj(file.file, handle)

        job_id = uuid.uuid4().hex[:12]
        now = datetime.now().isoformat(timespec="seconds")
        jobs[job_id] = {
            "id": job_id,
            "status": "queued",
            "audio_path": str(audio_path),
            "language": language or "auto",
            "model": model or "auto",
            "created_at": now,
            "updated_at": now,
            "result": None,
            "error": None,
        }
        start_job(job_id)
        return JSONResponse(jobs[job_id])

    @app.get("/jobs/{job_id}")
    async def get_job(job_id: str) -> JSONResponse:
        if job_id not in jobs:
            raise HTTPException(status_code=404, detail="Job not found")
        return JSONResponse(jobs[job_id])

    @app.post("/v1/audio/transcriptions")
    async def openai_transcription(
        file: UploadFile = File(...),
        language: str = Form("auto"),
        model: str = Form("auto"),
        response_format: str = Form("json"),
    ) -> JSONResponse:
        source_name = _safe_filename(file.filename or "audio.wav")
        audio_path = _unique_path(audio_dir, f"openai-{uuid.uuid4().hex[:8]}-{source_name}")
        with audio_path.open("wb") as handle:
            shutil.copyfileobj(file.file, handle)
        payload = backend.transcribe(audio_path, language=language, model=model, output_mode="speaker_timestamp")
        return JSONResponse(normalize_response(payload))

    return app


app = create_app()
