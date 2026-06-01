from __future__ import annotations

import mimetypes
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from .formatter import normalize_response
from .lifecycle import BackendLifecycle


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class BackendConfig:
    asr_model: str = "auto"
    language: str = "auto"
    enable_diarization: bool = True
    enable_timestamps: bool = True
    idle_timeout: int = 300
    ready_timeout: int = 1800

    @classmethod
    def from_env(cls) -> "BackendConfig":
        return cls(
            asr_model=(os.getenv("ASR_MODEL") or "auto").strip() or "auto",
            language=(os.getenv("LANGUAGE") or "auto").strip() or "auto",
            enable_diarization=_env_bool("ENABLE_DIARIZATION", True),
            enable_timestamps=_env_bool("ENABLE_TIMESTAMPS", True),
            idle_timeout=int(os.getenv("IDLE_TIMEOUT", "300")),
            ready_timeout=int(os.getenv("ASR_READY_TIMEOUT", "1800")),
        )

    def transcription_form(self, *, language: str | None = None, model: str | None = None) -> dict[str, str]:
        selected_language = language if language and language != "auto" else self.language
        selected_model = model if model and model != "auto" else self.asr_model
        data: dict[str, str] = {}
        if self.enable_timestamps:
            data["response_format"] = "verbose_json"
        else:
            data["response_format"] = "json"
        if self.enable_diarization:
            data["enable_speaker_diarization"] = "true"
        if selected_language and selected_language != "auto":
            data["language"] = selected_language
        if selected_model and selected_model != "auto":
            data["model"] = selected_model
        return data


class QwenBackend:
    def __init__(
        self,
        *,
        backend_url: str = "http://127.0.0.1:18000",
        command: list[str] | None = None,
        config: BackendConfig | None = None,
        ready_timeout: int | None = None,
    ) -> None:
        self.backend_url = backend_url.rstrip("/")
        self.config = config or BackendConfig.from_env()
        self.ready_timeout = ready_timeout if ready_timeout is not None else self.config.ready_timeout
        self.lifecycle = BackendLifecycle(
            command=command or ["/opt/venv/bin/python", "-m", "gateway_app.qwen_child"],
            ready_check=self._wait_for_ready,
            idle_timeout=self.config.idle_timeout,
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
            data = self.config.transcription_form(language=language, model=model)
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
