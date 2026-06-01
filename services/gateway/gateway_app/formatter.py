from __future__ import annotations

import re
from typing import Any, Literal

OutputMode = Literal["plain", "timestamp", "speaker_timestamp"]

QWEN_ASR_TAG_RE = re.compile(r"\s*language\s+[^<]*<asr_text>\s*", re.IGNORECASE)


def clean_asr_text(value: Any) -> str:
    text = str(value or "")
    text = QWEN_ASR_TAG_RE.sub("", text)
    return text.replace("<asr_text>", "").strip()


def format_timestamp(seconds: Any) -> str:
    try:
        total = max(0, int(float(seconds)))
    except (TypeError, ValueError):
        total = 0
    hours, remainder = divmod(total, 3600)
    minutes, secs = divmod(remainder, 60)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}"


def _time_value(segment: dict[str, Any], *keys: str) -> float:
    for key in keys:
        if key in segment and segment[key] is not None:
            value = float(segment[key])
            if key.endswith("_milliseconds") or key in {"begin_time", "end_time"} and value > 1000:
                return value / 1000.0
            return value
    return 0.0


def _speaker_value(segment: dict[str, Any]) -> str | None:
    speaker = segment.get("speaker") or segment.get("speaker_id") or segment.get("spk")
    if speaker is None:
        return None
    cleaned = str(speaker).strip()
    return cleaned or None


def extract_source_segments(payload: dict[str, Any]) -> list[dict[str, Any]]:
    segments = payload.get("segments") or payload.get("sentence_info") or []
    if not isinstance(segments, list):
        return []
    return [item for item in segments if isinstance(item, dict)]


def normalize_segment(segment: dict[str, Any]) -> dict[str, Any] | None:
    text = clean_asr_text(segment.get("text") or segment.get("sentence") or segment.get("raw_text"))
    if not text:
        return None

    normalized: dict[str, Any] = {
        "start": _time_value(segment, "start", "start_time", "begin_time", "begin_time_milliseconds"),
        "end": _time_value(segment, "end", "end_time", "end_time_milliseconds"),
        "text": text,
    }
    speaker = _speaker_value(segment)
    if speaker:
        normalized["speaker"] = speaker
    if isinstance(segment.get("words"), list):
        normalized["words"] = segment["words"]
    return normalized


def normalize_response(value: Any) -> Any:
    if isinstance(value, list):
        return [normalize_response(item) for item in value]
    if not isinstance(value, dict):
        return clean_asr_text(value) if isinstance(value, str) else value

    normalized = {key: normalize_response(item) for key, item in value.items()}
    if "text" not in normalized and isinstance(normalized.get("result"), str):
        normalized["text"] = normalized["result"]

    segments = []
    for segment in extract_source_segments(value):
        normalized_segment = normalize_segment(segment)
        if normalized_segment:
            segments.append(normalized_segment)
    if segments:
        normalized["segments"] = segments

    if isinstance(normalized.get("text"), str):
        normalized["text"] = clean_asr_text(normalized["text"])
    if isinstance(normalized.get("result"), str):
        normalized["result"] = clean_asr_text(normalized["result"])
    return normalized


def render_text_transcript(payload: dict[str, Any], output_mode: OutputMode = "speaker_timestamp") -> str:
    normalized = normalize_response(payload)
    segments = normalized.get("segments") if isinstance(normalized, dict) else None
    if isinstance(segments, list) and segments:
        lines: list[str] = []
        for segment in segments:
            text = clean_asr_text(segment.get("text"))
            if not text:
                continue
            if output_mode == "plain":
                lines.append(text)
            elif output_mode == "timestamp":
                lines.append(f"[{format_timestamp(segment.get('start'))} - {format_timestamp(segment.get('end'))}] {text}")
            else:
                speaker = str(segment.get("speaker") or "Speaker").strip() or "Speaker"
                lines.append(
                    f"[{format_timestamp(segment.get('start'))} - {format_timestamp(segment.get('end'))}] {speaker}: {text}"
                )
        return "\n".join(lines).strip() + ("\n" if lines else "")

    text = clean_asr_text(normalized.get("text") or normalized.get("result") if isinstance(normalized, dict) else "")
    return text + ("\n" if text else "")

