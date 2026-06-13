from __future__ import annotations

import os
import sqlite3
from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import JSONResponse

from .env import env_bool, env_float


def _voiceprint_enabled() -> bool:
    return env_bool("VOICEPRINT_ENABLED", True)


def _voiceprint_db_path() -> str:
    return (os.getenv("VOICEPRINT_DB_PATH") or "/data/voiceprints.sqlite3").strip()


def _voiceprint_match_threshold() -> float:
    return env_float("VOICEPRINT_MATCH_THRESHOLD", 0.70, min_value=0, max_value=1)


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


def _backend_error_response(exc: Exception) -> JSONResponse:
    return JSONResponse({"message": f"Voiceprint backend is unavailable: {exc}"}, status_code=502)


def _quote_sqlite_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def _count_speakers(connection: sqlite3.Connection, table_name: str) -> int:
    quoted_table = _quote_sqlite_identifier(table_name)
    columns = {row[1] for row in connection.execute(f"pragma table_info({quoted_table})")}
    if "status" in columns and "deleted_at" in columns:
        where_clause = " where deleted_at is null and status != 'deleted'"
    elif "status" in columns:
        where_clause = " where status != 'deleted'"
    elif "deleted_at" in columns:
        where_clause = " where deleted_at is null"
    elif "is_deleted" in columns:
        where_clause = " where is_deleted = 0"
    else:
        where_clause = ""
    row = connection.execute(f"select count(*) from {quoted_table}{where_clause}").fetchone()
    return int(row[0] if row else 0)


def _voiceprint_db_status() -> dict[str, Any]:
    configured_path = _voiceprint_db_path()
    db_path = Path(configured_path)
    status: dict[str, Any] = {
        "db_path": configured_path,
        "db_exists": db_path.exists(),
        "db_size_bytes": db_path.stat().st_size if db_path.exists() else 0,
        "match_threshold": _voiceprint_match_threshold(),
        "speaker_count": None,
    }
    if not db_path.exists():
        return status

    try:
        with sqlite3.connect(f"file:{db_path}?mode=ro", uri=True) as connection:
            tables = {
                row[0]
                for row in connection.execute(
                    "select name from sqlite_master where type in ('table', 'view')"
                ).fetchall()
            }
            for table_name in ("voiceprint_speakers", "speakers", "speaker_profiles"):
                if table_name in tables:
                    status["speaker_count"] = _count_speakers(connection, table_name)
                    break
    except sqlite3.Error as exc:
        status["db_error"] = str(exc)
    return status


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
        return JSONResponse({"enabled": _voiceprint_enabled(), **_voiceprint_db_status()})

    @router.get("/speakers")
    async def list_speakers() -> JSONResponse:
        if not _voiceprint_enabled():
            return _disabled_response()
        try:
            response = backend.upstream_request("GET", "/api/v1/voiceprint-speakers")
        except Exception as exc:
            return _backend_error_response(exc)
        return _json_response_from_upstream(response)

    @router.post("/speakers")
    async def create_speaker(
        display_name: str = Form(...),
        description: str | None = Form(None),
        files: list[UploadFile] = File(..., alias="file"),
    ) -> JSONResponse:
        if not _voiceprint_enabled():
            return _disabled_response()
        try:
            response = backend.upstream_request(
                "POST",
                "/api/v1/voiceprint-speakers",
                data={"display_name": display_name, "description": description or ""},
                files=await _upload_files(files),
            )
        except Exception as exc:
            return _backend_error_response(exc)
        return _json_response_from_upstream(response)

    @router.post("/speakers/{speaker_id}/samples")
    async def add_samples(
        speaker_id: str,
        files: list[UploadFile] = File(..., alias="file"),
    ) -> JSONResponse:
        if not _voiceprint_enabled():
            return _disabled_response()
        try:
            response = backend.upstream_request(
                "POST",
                f"/api/v1/voiceprint-speakers/{speaker_id}/samples",
                files=await _upload_files(files),
            )
        except Exception as exc:
            return _backend_error_response(exc)
        return _json_response_from_upstream(response)

    @router.delete("/speakers/{speaker_id}")
    async def delete_speaker(speaker_id: str) -> JSONResponse:
        if not _voiceprint_enabled():
            return _disabled_response()
        try:
            response = backend.upstream_request("DELETE", f"/api/v1/voiceprint-speakers/{speaker_id}")
        except Exception as exc:
            return _backend_error_response(exc)
        return _json_response_from_upstream(response)

    return router
