from __future__ import annotations

import mimetypes
import os
import signal
import time
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from .env import env_bool, env_float
from .formatter import apply_default_speaker, normalize_response
from .lifecycle import BackendLifecycle


@dataclass(frozen=True)
class BackendConfig:
    asr_model: str = "auto"
    language: str = "auto"
    enable_diarization: bool = True
    enable_timestamps: bool = True
    idle_timeout: int = 300
    ready_timeout: int = 1800
    min_diarization_duration_seconds: float = 5.0

    @classmethod
    def from_env(cls) -> "BackendConfig":
        return cls(
            asr_model=(os.getenv("ASR_MODEL") or "auto").strip() or "auto",
            language=(os.getenv("LANGUAGE") or "auto").strip() or "auto",
            enable_diarization=env_bool("ENABLE_DIARIZATION", True),
            enable_timestamps=env_bool("ENABLE_TIMESTAMPS", True),
            idle_timeout=int(os.getenv("IDLE_TIMEOUT", "300")),
            ready_timeout=int(os.getenv("ASR_READY_TIMEOUT", "1800")),
            min_diarization_duration_seconds=env_float("MIN_DIARIZATION_DURATION_SECONDS", 5.0, min_value=0),
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
            managed_shutdown_signal=getattr(signal, "SIGUSR1", None),
        )

    def _wait_for_ready(self) -> bool:
        deadline = time.monotonic() + self.ready_timeout
        with httpx.Client(timeout=2) as client:
            while time.monotonic() < deadline:
                returncode = self.lifecycle.process_returncode
                if returncode is not None:
                    raise RuntimeError(f"ASR backend exited before becoming ready (exit code {returncode})")
                for path in ("/v1/models", "/stream/v1/asr/health"):
                    try:
                        if client.get(f"{self.backend_url}{path}").status_code == 200:
                            return True
                    except httpx.HTTPError:
                        pass
                time.sleep(0.5)
        return False

    def ensure_ready(self) -> None:
        self.lifecycle.ensure_ready()

    def upstream_request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        self.ensure_ready()
        with httpx.Client(timeout=3600) as client:
            return client.request(method, f"{self.backend_url}{path}", **kwargs)

    def _wav_duration_seconds(self, audio_path: Path) -> float | None:
        if audio_path.suffix.lower() != ".wav":
            return None
        try:
            with wave.open(str(audio_path), "rb") as handle:
                frame_rate = handle.getframerate()
                if frame_rate <= 0:
                    return None
                return handle.getnframes() / float(frame_rate)
        except (EOFError, OSError, wave.Error):
            return None

    def _should_skip_diarization(self, audio_path: Path) -> bool:
        if not self.config.enable_diarization:
            return False
        duration = self._wav_duration_seconds(audio_path)
        return duration is not None and duration < self.config.min_diarization_duration_seconds

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
            skip_diarization = self._should_skip_diarization(audio_path)
            if skip_diarization:
                data["enable_speaker_diarization"] = "false"
            content_type = mimetypes.guess_type(audio_path.name)[0] or "application/octet-stream"
            with audio_path.open("rb") as handle:
                with httpx.Client(timeout=3600) as client:
                    response = client.post(
                        f"{self.backend_url}/v1/audio/transcriptions",
                        data=data,
                        files={"file": (audio_path.name, handle, content_type)},
                    )
            response.raise_for_status()
            result = normalize_response(response.json())
            if skip_diarization and isinstance(result, dict):
                apply_default_speaker(result, "Speaker1")
            return result
        finally:
            self.lifecycle.mark_activity_finished()
