from __future__ import annotations

import mimetypes
import os
import time
from pathlib import Path
from typing import Any

import httpx

from .formatter import normalize_response
from .lifecycle import BackendLifecycle


class QwenBackend:
    def __init__(
        self,
        *,
        backend_url: str = "http://127.0.0.1:18000",
        command: list[str] | None = None,
        idle_timeout: int | None = None,
        ready_timeout: int = 900,
    ) -> None:
        self.backend_url = backend_url.rstrip("/")
        self.ready_timeout = ready_timeout
        self.lifecycle = BackendLifecycle(
            command=command or ["/opt/venv/bin/python", "start.py"],
            ready_check=self._wait_for_ready,
            idle_timeout=idle_timeout if idle_timeout is not None else int(os.getenv("IDLE_TIMEOUT", "300")),
        )

    def _wait_for_ready(self) -> bool:
        deadline = time.monotonic() + self.ready_timeout
        with httpx.Client(timeout=2) as client:
            while time.monotonic() < deadline:
                for path in ("/health", "/v1/models", "/stream/v1/asr/health"):
                    try:
                        if client.get(f"{self.backend_url}{path}").status_code == 200:
                            return True
                    except httpx.HTTPError:
                        pass
                time.sleep(0.5)
        return False

    def transcribe(
        self,
        audio_path: Path,
        *,
        language: str | None = None,
        model: str | None = None,
        output_mode: str = "speaker_timestamp",
    ) -> dict[str, Any]:
        self.lifecycle.mark_activity_started()
        try:
            self.lifecycle.ensure_ready()
            data: dict[str, str] = {
                "response_format": "verbose_json",
                "enable_speaker_diarization": "true",
            }
            if language and language != "auto":
                data["language"] = language
            if model and model != "auto":
                data["model"] = model
            content_type = mimetypes.guess_type(audio_path.name)[0] or "application/octet-stream"
            with audio_path.open("rb") as handle:
                with httpx.Client(timeout=3600) as client:
                    response = client.post(
                        f"{self.backend_url}/v1/audio/transcriptions",
                        data=data,
                        files={"file": (audio_path.name, handle, content_type)},
                    )
            response.raise_for_status()
            result = response.json()
            return normalize_response(result)
        finally:
            self.lifecycle.mark_activity_finished()

