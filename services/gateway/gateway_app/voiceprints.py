from __future__ import annotations

import os
from typing import Any

import httpx
from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import JSONResponse


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _voiceprint_enabled() -> bool:
    return _env_bool("VOICEPRINT_ENABLED", True)


def _voiceprint_db_path() -> str:
    return (os.getenv("VOICEPRINT_DB_PATH") or "/data/voiceprints.sqlite3").strip()


def _disabled_response() -> JSONResponse:
    return JSONResponse(
        {"message": "Voiceprint support is disabled. Set VOICEPRINT_ENABLED=true to enable it."},
        status_code=503,
    )


def _json_response_from_upstream(response: httpx.Response) -> JSONResponse:
    try:
        payload: Any = response.json()
    except ValueError:
        payload = {"message": response.text}
    if response.status_code >= 400:
        message = payload.get("message") if isinstance(payload, dict) else str(payload)
        return JSONResponse({"message": message or "Voiceprint upstream request failed"}, status_code=502)
    return JSONResponse(payload, status_code=response.status_code)


async def _upload_files(files: list[UploadFile]) -> list[tuple[str, tuple[str, bytes, str]]]:
    prepared: list[tuple[str, tuple[str, bytes, str]]] = []
    for upload in files:
        prepared.append(
            (
                "file",
                (
                    upload.filename or "voiceprint.wav",
                    await upload.read(),
                    upload.content_type or "application/octet-stream",
                ),
            )
        )
    return prepared


def create_voiceprint_router(backend: Any) -> APIRouter:
    router = APIRouter(prefix="/voiceprints", tags=["Voiceprints"])

    @router.get("/health")
    async def health() -> JSONResponse:
        return JSONResponse(
            {
                "enabled": _voiceprint_enabled(),
                "db_path": _voiceprint_db_path(),
                "speaker_count": None,
            }
        )

    @router.get("/speakers")
    async def list_speakers() -> JSONResponse:
        if not _voiceprint_enabled():
            return _disabled_response()
        response = backend.upstream_request("GET", "/api/v1/voiceprint-speakers")
        return _json_response_from_upstream(response)

    @router.post("/speakers")
    async def create_speaker(
        display_name: str = Form(...),
        description: str | None = Form(None),
        files: list[UploadFile] = File(..., alias="file"),
    ) -> JSONResponse:
        if not _voiceprint_enabled():
            return _disabled_response()
        response = backend.upstream_request(
            "POST",
            "/api/v1/voiceprint-speakers",
            data={"display_name": display_name, "description": description or ""},
            files=await _upload_files(files),
        )
        return _json_response_from_upstream(response)

    @router.post("/speakers/{speaker_id}/samples")
    async def add_samples(
        speaker_id: str,
        files: list[UploadFile] = File(..., alias="file"),
    ) -> JSONResponse:
        if not _voiceprint_enabled():
            return _disabled_response()
        response = backend.upstream_request(
            "POST",
            f"/api/v1/voiceprint-speakers/{speaker_id}/samples",
            files=await _upload_files(files),
        )
        return _json_response_from_upstream(response)

    @router.delete("/speakers/{speaker_id}")
    async def delete_speaker(speaker_id: str) -> JSONResponse:
        if not _voiceprint_enabled():
            return _disabled_response()
        response = backend.upstream_request("DELETE", f"/api/v1/voiceprint-speakers/{speaker_id}")
        return _json_response_from_upstream(response)

    return router
