from __future__ import annotations

import math
import re
from typing import Any

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


def _numeric_value(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    return numeric if math.isfinite(numeric) else None


def _first_present(*values: Any) -> Any | None:
    for value in values:
        if value is not None and value != "":
            return value
    return None


def _first_numeric(*values: Any) -> float | None:
    for value in values:
        numeric = _numeric_value(value)
        if numeric is not None:
            return numeric
    return None


def _speaker_match_value(segment: dict[str, Any]) -> dict[str, Any] | None:
    upstream = segment.get("speaker_match")
    match = upstream if isinstance(upstream, dict) else {}
    normalized = {
        "speaker_id": _first_present(
            match.get("speaker_id"),
            match.get("matched_speaker_id"),
            segment.get("matched_speaker_id"),
            segment.get("speaker_profile_id"),
        ),
        "display_name": _first_present(
            match.get("display_name"),
            match.get("matched_display_name"),
            match.get("matched_speaker_name"),
            segment.get("matched_display_name"),
            segment.get("matched_speaker_name"),
            segment.get("speaker_name"),
        ),
        "confidence": _first_numeric(
            match.get("confidence"),
            match.get("speaker_confidence"),
            segment.get("speaker_confidence"),
            segment.get("confidence"),
        ),
        "status": match.get("status") or match.get("speaker_match_status") or segment.get("speaker_match_status"),
    }
    meaningful = {key: value for key, value in normalized.items() if value is not None and value != ""}
    return meaningful or None


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
    speaker_match = _speaker_match_value(segment)
    if speaker_match:
        normalized["speaker_match"] = speaker_match
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
        normalized["sentence_info"] = segments

    if isinstance(normalized.get("text"), str):
        normalized["text"] = clean_asr_text(normalized["text"])
    if isinstance(normalized.get("result"), str):
        normalized["result"] = clean_asr_text(normalized["result"])
    return normalized
