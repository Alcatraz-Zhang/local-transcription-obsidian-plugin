# Meeting Speaker Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add speaker profiles, voiceprint registration, confidence-based speaker mapping, and safe transcript re-rendering to the local-transcription MVP.

**Architecture:** The plugin owns human-readable speaker profiles, mapping decisions, and note rendering. The gateway only proxies upstream Qwen3-ASR voiceprint APIs and normalizes match metadata. Raw ASR output remains preserved while final Markdown can show real speaker names.

**Tech Stack:** TypeScript, Obsidian API, Vitest, Python, FastAPI, httpx, pytest, Docker Compose, Qwen3-ASR upstream voiceprint APIs.

---

## Working Tree Guard

Current local AMI sample files are validation artifacts and are intentionally not part of this implementation plan:

- `transcript_test_samples/ami_es2002a/`
- `transcript_test_samples/README.md`
- `transcript_test_samples/metadata.json`

Do not stage these files unless the user explicitly chooses Git LFS or test-data versioning.

## File Structure

Gateway files:

- Create `services/gateway/gateway_app/voiceprints.py`
  - Owns voiceprint proxy routes and upstream request forwarding.
- Modify `services/gateway/gateway_app/backend.py`
  - Adds small public helpers for proxying non-transcription upstream endpoints.
- Modify `services/gateway/gateway_app/main.py`
  - Includes the voiceprint router.
- Modify `services/gateway/gateway_app/formatter.py`
  - Preserves voiceprint match metadata on normalized segments.
- Create `services/gateway/tests/test_voiceprints.py`
  - Tests proxy behavior, disabled behavior, and upstream failures.
- Modify `services/gateway/tests/test_backend.py`
  - Tests backend helper defaults.
- Modify `services/gateway/tests/test_formatter.py`
  - Tests match metadata preservation.

Plugin files:

- Create `apps/obsidian-plugin/src/speakers.ts`
  - Pure speaker profile, mapping, merge, and confidence policy logic.
- Create `apps/obsidian-plugin/src/speakers.test.ts`
  - Tests confidence and mapping behavior.
- Create `apps/obsidian-plugin/src/speakerStore.ts`
  - Reads and writes `.local-transcription/speakers.json`.
- Create `apps/obsidian-plugin/src/speakerStore.test.ts`
  - Tests storage through a small fake vault adapter.
- Create `apps/obsidian-plugin/src/noteArtifacts.ts`
  - Builds frontmatter/sidecar payloads and applies speaker maps to transcript rendering.
- Create `apps/obsidian-plugin/src/noteArtifacts.test.ts`
  - Tests frontmatter size behavior and raw ASR preservation.
- Modify `apps/obsidian-plugin/src/gatewayClient.ts`
  - Adds voiceprint client methods.
- Create `apps/obsidian-plugin/src/gatewayClient.test.ts`
  - Tests voiceprint client request shapes.
- Modify `apps/obsidian-plugin/src/transcript.ts`
  - Adds match metadata fields and speaker-map-aware rendering.
- Modify `apps/obsidian-plugin/src/transcript.test.ts`
  - Tests real display names and original speaker preservation.
- Modify `apps/obsidian-plugin/src/settings.ts`
  - Adds speaker workflow settings.
- Modify `apps/obsidian-plugin/src/main.ts`
  - Wires speaker mapping into note creation and adds commands.

Docs:

- Modify `README.md`
  - Documents speaker workflow, voiceprint volume persistence, and manual review expectations.

---

### Task 1: Gateway Voiceprint Proxy

**Files:**
- Create: `services/gateway/gateway_app/voiceprints.py`
- Modify: `services/gateway/gateway_app/backend.py`
- Modify: `services/gateway/gateway_app/main.py`
- Create: `services/gateway/tests/test_voiceprints.py`
- Modify: `services/gateway/tests/test_backend.py`

- [ ] **Step 1: Write failing voiceprint proxy tests**

Create `services/gateway/tests/test_voiceprints.py`:

```python
from pathlib import Path

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
    backend = FakeVoiceprintBackend()
    app = create_app(backend=backend, storage_root=tmp_path, run_jobs_inline=True)
    client = TestClient(app)

    response = client.get("/voiceprints/health")

    assert response.status_code == 200
    assert response.json() == {
        "enabled": True,
        "db_path": "/data/voiceprints.sqlite3",
        "speaker_count": None,
    }
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
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```powershell
python -m pytest services/gateway/tests/test_voiceprints.py -q
```

Expected: fails because `/voiceprints/*` routes and backend helpers do not exist.

- [ ] **Step 3: Implement backend helpers**

Modify `services/gateway/gateway_app/backend.py` by adding this method inside `QwenBackend`:

```python
    def ensure_ready(self) -> None:
        self.lifecycle.ensure_ready()

    def upstream_request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        self.ensure_ready()
        with httpx.Client(timeout=3600) as client:
            return client.request(method, f"{self.backend_url}{path}", **kwargs)
```

Also update `test_qwen_backend_starts_wrapped_child_entrypoint` in `services/gateway/tests/test_backend.py` with:

```python
def test_qwen_backend_exposes_upstream_proxy_helpers():
    backend = QwenBackend()

    assert callable(backend.ensure_ready)
    assert callable(backend.upstream_request)
```

- [ ] **Step 4: Implement voiceprint routes**

Create `services/gateway/gateway_app/voiceprints.py`:

```python
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
```

- [ ] **Step 5: Include router in app**

Modify `services/gateway/gateway_app/main.py`:

```python
from .voiceprints import create_voiceprint_router
```

After CORS middleware setup, add:

```python
    app.include_router(create_voiceprint_router(backend))
```

- [ ] **Step 6: Run gateway tests**

Run:

```powershell
python -m pytest services/gateway/tests -q
```

Expected: all gateway tests pass.

- [ ] **Step 7: Commit**

```powershell
git add services/gateway/gateway_app/backend.py services/gateway/gateway_app/main.py services/gateway/gateway_app/voiceprints.py services/gateway/tests/test_backend.py services/gateway/tests/test_voiceprints.py
git commit -m "feat: proxy voiceprint speaker APIs"
```

---

### Task 2: Normalize Voiceprint Match Metadata

**Files:**
- Modify: `services/gateway/gateway_app/formatter.py`
- Modify: `services/gateway/tests/test_formatter.py`
- Modify: `apps/obsidian-plugin/src/transcript.ts`
- Modify: `apps/obsidian-plugin/src/transcript.test.ts`

- [ ] **Step 1: Write gateway formatter test**

Append to `services/gateway/tests/test_formatter.py`:

```python
def test_normalize_response_preserves_voiceprint_match_metadata():
    payload = {
        "segments": [
            {
                "start_time": 1,
                "end_time": 2,
                "speaker_id": "说话人2",
                "text": "hello",
                "matched_speaker_id": "vp_abc",
                "matched_display_name": "Alice",
                "speaker_confidence": 0.88,
            }
        ]
    }

    normalized = normalize_response(payload)

    assert normalized["segments"][0] == {
        "start": 1.0,
        "end": 2.0,
        "text": "hello",
        "speaker": "说话人2",
        "matched_speaker_id": "vp_abc",
        "matched_display_name": "Alice",
        "speaker_confidence": 0.88,
    }
```

- [ ] **Step 2: Run formatter test to verify failure**

```powershell
python -m pytest services/gateway/tests/test_formatter.py::test_normalize_response_preserves_voiceprint_match_metadata -q
```

Expected: fails because metadata is dropped.

- [ ] **Step 3: Preserve metadata in gateway formatter**

Modify `normalize_segment()` in `services/gateway/gateway_app/formatter.py` after speaker handling:

```python
    for source_key, target_key in (
        ("matched_speaker_id", "matched_speaker_id"),
        ("speaker_profile_id", "matched_speaker_id"),
        ("matched_display_name", "matched_display_name"),
        ("speaker_name", "matched_display_name"),
        ("speaker_confidence", "speaker_confidence"),
        ("confidence", "speaker_confidence"),
    ):
        value = segment.get(source_key)
        if value is None or value == "":
            continue
        if target_key == "speaker_confidence":
            try:
                normalized[target_key] = float(value)
            except (TypeError, ValueError):
                continue
        else:
            normalized[target_key] = str(value).strip()
```

- [ ] **Step 4: Write plugin transcript metadata test**

Append to `apps/obsidian-plugin/src/transcript.test.ts`:

```typescript
it("normalizes voiceprint match metadata from gateway segments", () => {
  const segments = normalizeSegments({
    segments: [
      {
        start: 1,
        end: 2,
        speaker: "说话人2",
        text: "hello",
        matched_speaker_id: "vp_abc",
        matched_display_name: "Alice",
        speaker_confidence: 0.88
      }
    ]
  });

  expect(segments[0]).toMatchObject({
    speaker: "说话人2",
    matchedSpeakerId: "vp_abc",
    matchedDisplayName: "Alice",
    speakerConfidence: 0.88
  });
});
```

- [ ] **Step 5: Update plugin transcript types and normalizer**

Modify `apps/obsidian-plugin/src/transcript.ts`:

```typescript
export interface NormalizedSegment {
  start: number;
  end: number;
  speaker?: string;
  originalSpeaker?: string;
  text: string;
  words?: unknown[];
  matchedSpeakerId?: string;
  matchedDisplayName?: string;
  speakerConfidence?: number;
}
```

Add to `RawSegment`:

```typescript
  matched_speaker_id?: string;
  speaker_profile_id?: string;
  matched_display_name?: string;
  speaker_name?: string;
  speaker_confidence?: number;
  confidence?: number;
```

Add helper:

```typescript
function optionalText(value: unknown): string | undefined {
  const cleaned = cleanAsrText(value);
  return cleaned || undefined;
}

function optionalNumber(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}
```

Update `normalizeSegments()` return object:

```typescript
      return {
        start: timeValue(segment, ["start", "start_time", "begin_time", "begin_time_milliseconds"]),
        end: timeValue(segment, ["end", "end_time", "end_time_milliseconds"]),
        speaker: speaker || undefined,
        originalSpeaker: speaker || undefined,
        text,
        words: Array.isArray(segment.words) ? segment.words : undefined,
        matchedSpeakerId: optionalText(segment.matched_speaker_id ?? segment.speaker_profile_id),
        matchedDisplayName: optionalText(segment.matched_display_name ?? segment.speaker_name),
        speakerConfidence: optionalNumber(segment.speaker_confidence ?? segment.confidence)
      };
```

- [ ] **Step 6: Run formatter and plugin transcript tests**

```powershell
python -m pytest services/gateway/tests/test_formatter.py -q
npm run test -w @local-transcription/obsidian-plugin -- transcript
```

Expected: both pass.

- [ ] **Step 7: Commit**

```powershell
git add services/gateway/gateway_app/formatter.py services/gateway/tests/test_formatter.py apps/obsidian-plugin/src/transcript.ts apps/obsidian-plugin/src/transcript.test.ts
git commit -m "feat: preserve speaker match metadata"
```

---

### Task 3: Plugin Speaker Domain and Confidence Policy

**Files:**
- Create: `apps/obsidian-plugin/src/speakers.ts`
- Create: `apps/obsidian-plugin/src/speakers.test.ts`

- [ ] **Step 1: Write speaker domain tests**

Create `apps/obsidian-plugin/src/speakers.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  applySpeakerMap,
  buildInitialSpeakerMap,
  confidenceAction,
  mergeSpeakerLabels,
  type MeetingSpeakerMap,
  type SpeakerProfile
} from "./speakers";
import type { NormalizedSegment } from "./transcript";

const profiles: SpeakerProfile[] = [
  {
    id: "vault-speaker-alice",
    displayName: "Alice",
    aliases: ["PM"],
    gatewaySpeakerId: "vp_alice",
    createdAt: "2026-06-02T00:00:00",
    updatedAt: "2026-06-02T00:00:00"
  }
];

describe("speaker confidence policy", () => {
  it("classifies confidence bands", () => {
    expect(confidenceAction(0.9)).toBe("auto");
    expect(confidenceAction(0.7)).toBe("suggest");
    expect(confidenceAction(0.2)).toBe("ignore");
    expect(confidenceAction(undefined)).toBe("ignore");
  });
});

describe("speaker map creation", () => {
  it("auto-applies high-confidence matches", () => {
    const segments: NormalizedSegment[] = [
      {
        start: 0,
        end: 1,
        speaker: "说话人1",
        text: "hello",
        matchedSpeakerId: "vp_alice",
        matchedDisplayName: "Alice",
        speakerConfidence: 0.91
      }
    ];

    const map = buildInitialSpeakerMap(segments, profiles);

    expect(map["说话人1"]).toMatchObject({
      displayName: "Alice",
      source: "auto_high_confidence",
      confidence: 0.91,
      gatewaySpeakerId: "vp_alice",
      autoMatched: true
    });
  });

  it("keeps medium-confidence matches as suggestions", () => {
    const segments: NormalizedSegment[] = [
      {
        start: 0,
        end: 1,
        speaker: "说话人2",
        text: "hello",
        matchedSpeakerId: "vp_alice",
        matchedDisplayName: "Alice",
        speakerConfidence: 0.7
      }
    ];

    const map = buildInitialSpeakerMap(segments, profiles);

    expect(map["说话人2"]).toMatchObject({
      suggestedDisplayName: "Alice",
      source: "suggested",
      confidence: 0.7,
      gatewaySpeakerId: "vp_alice"
    });
    expect(map["说话人2"].displayName).toBeUndefined();
  });

  it("manual mappings override automatic matches", () => {
    const existing: MeetingSpeakerMap = {
      "说话人1": {
        displayName: "Bob",
        source: "manual"
      }
    };
    const segments: NormalizedSegment[] = [
      {
        start: 0,
        end: 1,
        speaker: "说话人1",
        text: "hello",
        matchedDisplayName: "Alice",
        speakerConfidence: 0.95
      }
    ];

    const map = buildInitialSpeakerMap(segments, profiles, existing);

    expect(map["说话人1"].displayName).toBe("Bob");
    expect(map["说话人1"].source).toBe("manual");
  });
});

describe("speaker map application", () => {
  it("renders mapped display names while preserving original speaker", () => {
    const segments: NormalizedSegment[] = [{ start: 0, end: 1, speaker: "说话人1", text: "hello" }];
    const mapped = applySpeakerMap(segments, {
      "说话人1": { displayName: "Alice", source: "manual" }
    });

    expect(mapped[0].speaker).toBe("Alice");
    expect(mapped[0].originalSpeaker).toBe("说话人1");
  });

  it("merges labels into the target display name", () => {
    const map = mergeSpeakerLabels(
      {
        "说话人1": { displayName: "Alice", source: "manual" },
        "说话人3": { displayName: "Temp", source: "manual" }
      },
      "说话人3",
      "说话人1"
    );

    expect(map["说话人3"]).toMatchObject({
      displayName: "Alice",
      source: "manual",
      mergedInto: "说话人1"
    });
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```powershell
npm run test -w @local-transcription/obsidian-plugin -- speakers
```

Expected: fails because `speakers.ts` does not exist.

- [ ] **Step 3: Implement speaker domain**

Create `apps/obsidian-plugin/src/speakers.ts`:

```typescript
import type { NormalizedSegment } from "./transcript";

export type SpeakerMapSource = "manual" | "auto_high_confidence" | "suggested";
export type ConfidenceAction = "auto" | "suggest" | "ignore";

export interface SpeakerProfile {
  id: string;
  displayName: string;
  aliases: string[];
  gatewaySpeakerId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MeetingSpeakerMapEntry {
  displayName?: string;
  suggestedDisplayName?: string;
  source: SpeakerMapSource;
  confidence?: number;
  gatewaySpeakerId?: string;
  autoMatched?: boolean;
  mergedInto?: string;
}

export type MeetingSpeakerMap = Record<string, MeetingSpeakerMapEntry>;

export const HIGH_CONFIDENCE_THRESHOLD = 0.85;
export const MEDIUM_CONFIDENCE_THRESHOLD = 0.65;

export function confidenceAction(confidence: number | undefined): ConfidenceAction {
  if (confidence === undefined || !Number.isFinite(confidence)) {
    return "ignore";
  }
  if (confidence >= HIGH_CONFIDENCE_THRESHOLD) {
    return "auto";
  }
  if (confidence >= MEDIUM_CONFIDENCE_THRESHOLD) {
    return "suggest";
  }
  return "ignore";
}

function profileNameForMatch(segment: NormalizedSegment, profiles: SpeakerProfile[]): string | undefined {
  if (segment.matchedSpeakerId) {
    const profile = profiles.find((item) => item.gatewaySpeakerId === segment.matchedSpeakerId);
    if (profile) {
      return profile.displayName;
    }
  }
  return segment.matchedDisplayName;
}

export function buildInitialSpeakerMap(
  segments: NormalizedSegment[],
  profiles: SpeakerProfile[],
  existing: MeetingSpeakerMap = {}
): MeetingSpeakerMap {
  const next: MeetingSpeakerMap = { ...existing };
  for (const segment of segments) {
    const label = segment.originalSpeaker || segment.speaker;
    if (!label || next[label]?.source === "manual") {
      continue;
    }
    const displayName = profileNameForMatch(segment, profiles);
    if (!displayName) {
      continue;
    }
    const action = confidenceAction(segment.speakerConfidence);
    if (action === "auto") {
      next[label] = {
        displayName,
        source: "auto_high_confidence",
        confidence: segment.speakerConfidence,
        gatewaySpeakerId: segment.matchedSpeakerId,
        autoMatched: true
      };
    }
    if (action === "suggest") {
      next[label] = {
        suggestedDisplayName: displayName,
        source: "suggested",
        confidence: segment.speakerConfidence,
        gatewaySpeakerId: segment.matchedSpeakerId
      };
    }
  }
  return next;
}

export function applySpeakerMap(
  segments: NormalizedSegment[],
  speakerMap: MeetingSpeakerMap
): NormalizedSegment[] {
  return segments.map((segment) => {
    const originalSpeaker = segment.originalSpeaker || segment.speaker;
    const mapped = originalSpeaker ? speakerMap[originalSpeaker] : undefined;
    if (!originalSpeaker || !mapped?.displayName) {
      return { ...segment, originalSpeaker };
    }
    return {
      ...segment,
      originalSpeaker,
      speaker: mapped.displayName
    };
  });
}

export function mergeSpeakerLabels(
  speakerMap: MeetingSpeakerMap,
  sourceLabel: string,
  targetLabel: string
): MeetingSpeakerMap {
  const target = speakerMap[targetLabel];
  if (!target?.displayName) {
    return speakerMap;
  }
  return {
    ...speakerMap,
    [sourceLabel]: {
      displayName: target.displayName,
      source: "manual",
      gatewaySpeakerId: target.gatewaySpeakerId,
      mergedInto: targetLabel
    }
  };
}

export function createSpeakerProfile(displayName: string, gatewaySpeakerId?: string): SpeakerProfile {
  const now = new Date().toISOString();
  const id = `vault-speaker-${displayName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "speaker"}-${Date.now()}`;
  return {
    id,
    displayName: displayName.trim(),
    aliases: [],
    gatewaySpeakerId,
    createdAt: now,
    updatedAt: now
  };
}
```

- [ ] **Step 4: Run speaker tests**

```powershell
npm run test -w @local-transcription/obsidian-plugin -- speakers
```

Expected: pass.

- [ ] **Step 5: Commit**

```powershell
git add apps/obsidian-plugin/src/speakers.ts apps/obsidian-plugin/src/speakers.test.ts
git commit -m "feat: add speaker mapping policy"
```

---

### Task 4: Plugin Speaker Profile Storage

**Files:**
- Create: `apps/obsidian-plugin/src/speakerStore.ts`
- Create: `apps/obsidian-plugin/src/speakerStore.test.ts`

- [ ] **Step 1: Write speaker store tests**

Create `apps/obsidian-plugin/src/speakerStore.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { SpeakerStore, type VaultAdapter } from "./speakerStore";

class FakeVaultAdapter implements VaultAdapter {
  files = new Map<string, string>();

  async read(path: string): Promise<string | null> {
    return this.files.get(path) ?? null;
  }

  async write(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }
}

describe("SpeakerStore", () => {
  it("loads an empty list when the profile file does not exist", async () => {
    const store = new SpeakerStore(new FakeVaultAdapter());

    await expect(store.load()).resolves.toEqual([]);
  });

  it("saves and reloads speaker profiles", async () => {
    const adapter = new FakeVaultAdapter();
    const store = new SpeakerStore(adapter);

    await store.save([
      {
        id: "vault-speaker-alice",
        displayName: "Alice",
        aliases: ["PM"],
        gatewaySpeakerId: "vp_alice",
        createdAt: "2026-06-02T00:00:00",
        updatedAt: "2026-06-02T00:00:00"
      }
    ]);

    expect(await store.load()).toEqual([
      {
        id: "vault-speaker-alice",
        displayName: "Alice",
        aliases: ["PM"],
        gatewaySpeakerId: "vp_alice",
        createdAt: "2026-06-02T00:00:00",
        updatedAt: "2026-06-02T00:00:00"
      }
    ]);
  });

  it("rejects malformed profile JSON by returning an empty list", async () => {
    const adapter = new FakeVaultAdapter();
    adapter.files.set(".local-transcription/speakers.json", "{broken");
    const store = new SpeakerStore(adapter);

    await expect(store.load()).resolves.toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```powershell
npm run test -w @local-transcription/obsidian-plugin -- speakerStore
```

Expected: fails because `speakerStore.ts` does not exist.

- [ ] **Step 3: Implement store**

Create `apps/obsidian-plugin/src/speakerStore.ts`:

```typescript
import type { SpeakerProfile } from "./speakers";

export const SPEAKER_PROFILE_PATH = ".local-transcription/speakers.json";

export interface VaultAdapter {
  read(path: string): Promise<string | null>;
  write(path: string, content: string): Promise<void>;
}

function isProfile(value: unknown): value is SpeakerProfile {
  const item = value as SpeakerProfile;
  return Boolean(
    item &&
      typeof item.id === "string" &&
      typeof item.displayName === "string" &&
      Array.isArray(item.aliases) &&
      typeof item.createdAt === "string" &&
      typeof item.updatedAt === "string"
  );
}

export class SpeakerStore {
  constructor(
    private readonly adapter: VaultAdapter,
    private readonly path = SPEAKER_PROFILE_PATH
  ) {}

  async load(): Promise<SpeakerProfile[]> {
    const content = await this.adapter.read(this.path);
    if (!content) {
      return [];
    }
    try {
      const parsed = JSON.parse(content);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.filter(isProfile);
    } catch {
      return [];
    }
  }

  async save(profiles: SpeakerProfile[]): Promise<void> {
    const sorted = [...profiles].sort((a, b) => a.displayName.localeCompare(b.displayName));
    await this.adapter.write(this.path, `${JSON.stringify(sorted, null, 2)}\n`);
  }
}
```

- [ ] **Step 4: Run store tests**

```powershell
npm run test -w @local-transcription/obsidian-plugin -- speakerStore
```

Expected: pass.

- [ ] **Step 5: Commit**

```powershell
git add apps/obsidian-plugin/src/speakerStore.ts apps/obsidian-plugin/src/speakerStore.test.ts
git commit -m "feat: persist vault speaker profiles"
```

---

### Task 5: Gateway Client Voiceprint Methods

**Files:**
- Modify: `apps/obsidian-plugin/src/gatewayClient.ts`
- Create: `apps/obsidian-plugin/src/gatewayClient.test.ts`

- [ ] **Step 1: Write gateway client tests**

Create `apps/obsidian-plugin/src/gatewayClient.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";
import { GatewayClient } from "./gatewayClient";

describe("GatewayClient voiceprints", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists voiceprint speakers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ speakers: [{ speaker_id: "vp_1", display_name: "Alice" }] })
      })
    );
    const client = new GatewayClient("http://localhost:17002/");

    const result = await client.listVoiceprintSpeakers();

    expect(result.speakers[0].display_name).toBe("Alice");
    expect(fetch).toHaveBeenCalledWith("http://localhost:17002/voiceprints/speakers");
  });

  it("creates a voiceprint speaker with files", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ speaker_id: "vp_1" })
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new GatewayClient("http://localhost:17002");

    await client.createVoiceprintSpeaker({
      displayName: "Alice",
      description: "PM",
      files: [new Blob(["audio"])]
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:17002/voiceprints/speakers");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
  });

  it("throws on voiceprint HTTP errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    const client = new GatewayClient("http://localhost:17002");

    await expect(client.listVoiceprintSpeakers()).rejects.toThrow("Voiceprint speaker list failed");
  });
});
```

- [ ] **Step 2: Run client tests to verify failure**

```powershell
npm run test -w @local-transcription/obsidian-plugin -- gatewayClient
```

Expected: fails because methods are missing.

- [ ] **Step 3: Implement client methods**

Add interfaces to `apps/obsidian-plugin/src/gatewayClient.ts`:

```typescript
export interface VoiceprintSpeaker {
  speaker_id: string;
  display_name: string;
  description?: string | null;
  voiceprint_count?: number;
}

export interface VoiceprintSpeakerList {
  speakers: VoiceprintSpeaker[];
}
```

Add methods inside `GatewayClient`:

```typescript
  async listVoiceprintSpeakers(): Promise<VoiceprintSpeakerList> {
    const response = await fetch(`${this.gatewayUrl.replace(/\/$/, "")}/voiceprints/speakers`);
    if (!response.ok) {
      throw new Error(`Voiceprint speaker list failed with HTTP ${response.status}`);
    }
    return response.json();
  }

  async createVoiceprintSpeaker(options: {
    displayName: string;
    description?: string;
    files: Blob[];
  }): Promise<unknown> {
    const form = new FormData();
    form.append("display_name", options.displayName);
    form.append("description", options.description ?? "");
    options.files.forEach((file, index) => form.append("file", file, `voiceprint-${index + 1}.wav`));
    const response = await fetch(`${this.gatewayUrl.replace(/\/$/, "")}/voiceprints/speakers`, {
      method: "POST",
      body: form
    });
    if (!response.ok) {
      throw new Error(`Voiceprint speaker creation failed with HTTP ${response.status}`);
    }
    return response.json();
  }

  async addVoiceprintSamples(speakerId: string, files: Blob[]): Promise<unknown> {
    const form = new FormData();
    files.forEach((file, index) => form.append("file", file, `voiceprint-sample-${index + 1}.wav`));
    const response = await fetch(`${this.gatewayUrl.replace(/\/$/, "")}/voiceprints/speakers/${encodeURIComponent(speakerId)}/samples`, {
      method: "POST",
      body: form
    });
    if (!response.ok) {
      throw new Error(`Voiceprint sample upload failed with HTTP ${response.status}`);
    }
    return response.json();
  }
```

- [ ] **Step 4: Run client tests**

```powershell
npm run test -w @local-transcription/obsidian-plugin -- gatewayClient
```

Expected: pass.

- [ ] **Step 5: Commit**

```powershell
git add apps/obsidian-plugin/src/gatewayClient.ts apps/obsidian-plugin/src/gatewayClient.test.ts
git commit -m "feat: add voiceprint gateway client"
```

---

### Task 6: Speaker-Map-Aware Transcript and Note Artifacts

**Files:**
- Modify: `apps/obsidian-plugin/src/transcript.ts`
- Modify: `apps/obsidian-plugin/src/transcript.test.ts`
- Create: `apps/obsidian-plugin/src/noteArtifacts.ts`
- Create: `apps/obsidian-plugin/src/noteArtifacts.test.ts`

- [ ] **Step 1: Write transcript speaker map test**

Append to `apps/obsidian-plugin/src/transcript.test.ts`:

```typescript
it("renders mapped speaker names when a meeting speaker map is provided", () => {
  const text = transcriptText(
    {
      segments: [{ start: 0, end: 5, speaker: "说话人1", text: "hello" }]
    },
    "speaker_timestamp",
    {
      "说话人1": { displayName: "Alice", source: "manual" }
    }
  );

  expect(text).toBe("[00:00:00 - 00:00:05] Alice: hello");
});
```

- [ ] **Step 2: Write note artifact tests**

Create `apps/obsidian-plugin/src/noteArtifacts.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { buildSpeakerFrontmatter, shouldUseSpeakerSidecar } from "./noteArtifacts";

describe("note speaker artifacts", () => {
  it("stores small speaker maps in frontmatter", () => {
    const frontmatter = buildSpeakerFrontmatter({
      "说话人1": { displayName: "Alice", source: "manual" }
    });

    expect(frontmatter.local_transcription_speakers["说话人1"].displayName).toBe("Alice");
  });

  it("uses sidecar for large speaker maps", () => {
    const map = Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [
        `说话人${index}`,
        { displayName: `Speaker ${index}`, source: "manual" as const }
      ])
    );

    expect(shouldUseSpeakerSidecar(map)).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests to verify failure**

```powershell
npm run test -w @local-transcription/obsidian-plugin -- transcript noteArtifacts
```

Expected: fails because `transcriptText` has no speaker map parameter and `noteArtifacts.ts` does not exist.

- [ ] **Step 4: Update transcript rendering**

Modify `apps/obsidian-plugin/src/transcript.ts`:

```typescript
import { applySpeakerMap, type MeetingSpeakerMap } from "./speakers";
```

Change `transcriptText` signature and body:

```typescript
export function transcriptText(payload: GatewayTranscript, mode: OutputMode, speakerMap?: MeetingSpeakerMap): string {
  const segments = speakerMap ? applySpeakerMap(normalizeSegments(payload), speakerMap) : normalizeSegments(payload);
  if (segments.length) {
    return formatTranscript(segments, mode);
  }
  return payload.text?.trim() ?? "";
}
```

- [ ] **Step 5: Implement note artifact helpers**

Create `apps/obsidian-plugin/src/noteArtifacts.ts`:

```typescript
import type { MeetingSpeakerMap } from "./speakers";

export const SPEAKER_SIDECAR_THRESHOLD_BYTES = 4096;

export interface SpeakerFrontmatter {
  local_transcription_speakers: MeetingSpeakerMap;
}

export function buildSpeakerFrontmatter(speakerMap: MeetingSpeakerMap): SpeakerFrontmatter {
  return {
    local_transcription_speakers: speakerMap
  };
}

export function shouldUseSpeakerSidecar(speakerMap: MeetingSpeakerMap): boolean {
  return JSON.stringify(speakerMap).length > SPEAKER_SIDECAR_THRESHOLD_BYTES;
}

export function speakerSidecarPath(notePath: string): string {
  return notePath.replace(/\.md$/i, ".speaker-map.json");
}
```

- [ ] **Step 6: Run note artifact and transcript tests**

```powershell
npm run test -w @local-transcription/obsidian-plugin -- transcript noteArtifacts
```

Expected: pass.

- [ ] **Step 7: Commit**

```powershell
git add apps/obsidian-plugin/src/transcript.ts apps/obsidian-plugin/src/transcript.test.ts apps/obsidian-plugin/src/noteArtifacts.ts apps/obsidian-plugin/src/noteArtifacts.test.ts
git commit -m "feat: render transcripts with speaker maps"
```

---

### Task 7: Wire Speaker Workflow into Plugin Commands

**Files:**
- Modify: `apps/obsidian-plugin/src/settings.ts`
- Modify: `apps/obsidian-plugin/src/main.ts`
- Modify: `README.md`

- [ ] **Step 1: Add settings fields**

Modify `apps/obsidian-plugin/src/settings.ts`:

```typescript
export interface LocalTranscriptionSettings {
  gatewayUrl: string;
  audioSavePath: string;
  transcriptSavePath: string;
  noteFilenameTemplate: string;
  noteTemplate: string;
  outputMode: OutputMode;
  language: string;
  asrModel: string;
  postProcessingEnabled: boolean;
  postProcessingUrl: string;
  postProcessingModel: string;
  postProcessingPrompt: string;
  keepOriginalTranscription: boolean;
  speakerProfilesPath: string;
  autoApplySpeakerConfidence: number;
  suggestSpeakerConfidence: number;
}
```

Add defaults:

```typescript
  speakerProfilesPath: ".local-transcription/speakers.json",
  autoApplySpeakerConfidence: 0.85,
  suggestSpeakerConfidence: 0.65
```

- [ ] **Step 2: Add vault adapter in main plugin**

In `apps/obsidian-plugin/src/main.ts`, import:

```typescript
import { SpeakerStore, type VaultAdapter } from "./speakerStore";
import { buildInitialSpeakerMap } from "./speakers";
```

Add helper class near the top:

```typescript
class ObsidianVaultAdapter implements VaultAdapter {
  constructor(private readonly app: App) {}

  async read(path: string): Promise<string | null> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file || !("extension" in file)) {
      return null;
    }
    return this.app.vault.read(file as TFile);
  }

  async write(path: string, content: string): Promise<void> {
    await ensureFolder(this.app, path.split("/").slice(0, -1).join("/"));
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing && "extension" in existing) {
      await this.app.vault.modify(existing as TFile, content);
      return;
    }
    await this.app.vault.create(path, content);
  }
}
```

- [ ] **Step 3: Apply speaker map during transcription note creation**

In the method that receives `completed.result`, after `normalizeSegments(result)` is available, load profiles and build the initial map:

```typescript
const speakerStore = new SpeakerStore(new ObsidianVaultAdapter(this.app), this.pluginSettings.speakerProfilesPath);
const speakerProfiles = await speakerStore.load();
const speakerMap = buildInitialSpeakerMap(normalizedSegments, speakerProfiles);
const transcription = transcriptText(result, this.pluginSettings.outputMode, speakerMap);
```

Also write raw ASR JSON beside the note:

```typescript
const rawPath = notePath.replace(/\.md$/i, ".raw-asr.json");
await this.app.vault.create(rawPath, `${JSON.stringify(result, null, 2)}\n`);
```

If the raw file exists, use the existing `_uniquePath` helper pattern rather than overwriting.

- [ ] **Step 4: Add simple commands**

Add command:

```typescript
this.addCommand({
  id: "local-transcription-list-speakers",
  name: "local-transcription: List Speakers",
  callback: async () => {
    const store = new SpeakerStore(new ObsidianVaultAdapter(this.app), this.pluginSettings.speakerProfilesPath);
    const profiles = await store.load();
    new Notice(profiles.length ? profiles.map((profile) => profile.displayName).join(", ") : "No local-transcription speaker profiles yet.");
  }
});
```

Add command:

```typescript
this.addCommand({
  id: "local-transcription-refresh-voiceprint-speakers",
  name: "local-transcription: Check Voiceprint Speakers",
  callback: async () => {
    const client = new GatewayClient(this.pluginSettings.gatewayUrl);
    const speakers = await client.listVoiceprintSpeakers();
    new Notice(`Gateway voiceprint speakers: ${speakers.speakers.length}`);
  }
});
```

This task deliberately uses minimal commands first. Full modal UX can be added in a follow-up task after the storage and API paths are verified.

- [ ] **Step 5: Update README**

Add a section:

```markdown
## Speaker Workflow

The plugin stores human-readable speaker profiles in `.local-transcription/speakers.json`.
Gateway voiceprint embeddings are stored in the Docker `/data` volume.

Speaker matching is confidence-based:

- `>= 0.85`: applied automatically to the draft note.
- `0.65-0.85`: treated as a suggestion.
- `< 0.65`: the original temporary speaker label remains.

Raw ASR JSON is preserved beside generated notes so speaker re-rendering never destroys the backend result.
```

- [ ] **Step 6: Run plugin tests and build**

```powershell
npm run test -w @local-transcription/obsidian-plugin
npm run build
```

Expected: pass.

- [ ] **Step 7: Commit**

```powershell
git add apps/obsidian-plugin/src/settings.ts apps/obsidian-plugin/src/main.ts README.md
git commit -m "feat: wire speaker profiles into plugin"
```

---

### Task 8: Final Verification and Docker Smoke

**Files:**
- No files should be modified by this task. If a verification command fails, return to the task that introduced the failing behavior, fix it there, rerun that task's tests, then restart Task 8 from Step 1.

- [ ] **Step 1: Run full unit suite**

```powershell
npm run test
```

Expected:

- Plugin tests pass.
- Gateway tests pass.

- [ ] **Step 2: Run plugin build**

```powershell
npm run build
```

Expected: exit code `0`.

- [ ] **Step 3: Run compose config and build**

```powershell
docker compose config --quiet
docker compose build
```

Expected: both commands exit `0`.

- [ ] **Step 4: Run voiceprint health smoke**

```powershell
$env:IDLE_TIMEOUT='30'
$env:ASR_READY_TIMEOUT='1200'
docker compose up -d
Start-Sleep -Seconds 5
curl.exe -sS http://localhost:17002/health
curl.exe -sS http://localhost:17002/voiceprints/health
```

Expected:

- `/health` returns `"status":"ok"`.
- `/voiceprints/health` returns `"enabled":true` and `"/data/voiceprints.sqlite3"`.

- [ ] **Step 5: Run transcription regression**

```powershell
$job = curl.exe -sS -X POST http://localhost:17002/jobs `
  -F "file=@transcript_test_samples/english_librispeech_6930-75918-0000.wav" `
  -F "language=en" `
  -F "output_mode=speaker_timestamp" | ConvertFrom-Json
for ($i=0; $i -lt 90; $i++) {
  $status = curl.exe -sS "http://localhost:17002/jobs/$($job.id)" | ConvertFrom-Json
  if ($status.status -in @('completed','failed')) { $status | ConvertTo-Json -Depth 20; break }
  Start-Sleep -Seconds 10
}
```

Expected:

- Job completes.
- `segments[0].speaker` exists.
- `sentence_info[0].speaker` exists.

- [ ] **Step 6: Run idle VRAM/process validation**

```powershell
nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader,nounits
Start-Sleep -Seconds 50
curl.exe -sS http://localhost:17002/health
docker exec local-transcription-obsidian-plugin-asr-gateway-1 /bin/sh -lc 'ps -eo pid,ppid,stat,comm,args | grep -E "python|VLLM|gateway_app|docker-init" | grep -v grep'
nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader,nounits
```

Expected:

- `/health` reports `"backend_running":false`.
- No running `VLLM::EngineCore` process remains.
- VRAM drops materially after idle.

- [ ] **Step 7: Stop Docker**

```powershell
docker compose down
```

Expected: no local-transcription ASR containers remain running.

- [ ] **Step 8: Final git check**

```powershell
git status --short --branch
```

Expected:

- Only intentional AMI sample artifacts remain uncommitted, unless the user explicitly approved committing them.

---

## Plan Self-Review

Spec coverage:

- Gateway voiceprint proxy: Task 1.
- Match metadata normalization: Task 2.
- Vault speaker profiles: Tasks 3 and 4.
- Confidence policy: Task 3.
- Gateway client voiceprint calls: Task 5.
- Transcript re-rendering and raw ASR preservation: Task 6 and Task 7.
- Plugin commands: Task 7.
- Testing and Docker validation: Task 8.

No placeholders:

- No forbidden placeholder phrases remain.

Type consistency:

- `SpeakerProfile`, `MeetingSpeakerMap`, and `MeetingSpeakerMapEntry` are introduced before use.
- Gateway metadata fields map from snake_case backend fields to camelCase plugin fields.
- `GatewayClient` voiceprint methods use the same `/voiceprints/*` paths as the gateway proxy.
