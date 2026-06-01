from __future__ import annotations

import shutil
import threading
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .backend import QwenBackend
from .formatter import OutputMode, normalize_response, render_text_transcript


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
) -> FastAPI:
    root = storage_root or Path("/data")
    audio_dir = root / "audio"
    backend = backend or QwenBackend()
    jobs: dict[str, dict[str, Any]] = {}

    app = FastAPI(title="Obsidian Local ASR Gateway")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

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
            payload = normalize_response(payload)
            payload["text"] = render_text_transcript(payload, job.get("output_mode", "speaker_timestamp"))
            job["result"] = payload
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
        lifecycle = getattr(backend, "lifecycle", None)
        return {
            "status": "ok",
            "backend_running": bool(getattr(lifecycle, "running", False)),
            "active_tasks": int(getattr(lifecycle, "active_tasks", 0)),
            "queued_jobs": sum(1 for job in jobs.values() if job["status"] in {"queued", "running"}),
        }

    @app.post("/jobs")
    async def create_job(
        file: UploadFile = File(...),
        language: str = Form("auto"),
        model: str = Form("auto"),
        output_mode: OutputMode = Form("speaker_timestamp"),
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
            "output_mode": output_mode,
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
        payload = normalize_response(payload)
        payload["text"] = render_text_transcript(payload, "speaker_timestamp")
        return JSONResponse(payload)

    return app


app = create_app()

