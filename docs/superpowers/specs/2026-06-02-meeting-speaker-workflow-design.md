# Meeting Speaker Workflow Design

## Goal

Implement the next stage of Local Transcription as a meeting speaker workflow enhancement. The stage improves real meeting usability by adding speaker profiles, speaker mapping, voiceprint registration, confidence-based matching, and safe transcript re-rendering while keeping the current Qwen3-ASR backend as the default ASR and diarization engine.

## Scope

This stage uses the plugin as the main product surface and keeps the gateway as a minimal backend capability layer.

In scope:

- Vault speaker profile management.
- Manual speaker rename and merge after transcription.
- Voiceprint registration from uploaded or recorded reference audio.
- Later voiceprint sample enrichment from selected meeting segments, only after explicit user confirmation.
- Confidence-based automatic speaker name application.
- Gateway proxy endpoints for upstream voiceprint APIs.
- Segment normalization for voiceprint match metadata.
- Markdown transcript re-rendering with real speaker display names.
- Preservation of raw ASR output and original temporary speaker labels.
- Tests and manual validation for speaker mapping, voiceprint persistence, AMI multi-speaker samples, and idle VRAM release.

Out of scope:

- Replacing Qwen3-ASR or upstream CAM++ as the default diarization engine.
- Adding pyannote or NVIDIA NeMo as a default dependency.
- Building a full generic ASR/protocol gateway.
- Productizing WebSocket streaming UI.
- Exposing low-level CUDA, PyTorch, FunASR, vLLM, or diarization parameters to ordinary users.
- Automatically adding meeting segments to the voiceprint database without user confirmation.

## Architecture

The architecture uses dual persistence.

The Obsidian vault stores user-readable speaker data: display names, aliases, meeting-specific corrections, and final note rendering metadata. This keeps the human-facing state portable with the vault.

The gateway stores machine-facing voiceprint data: upstream speaker ids, embeddings, and sqlite voiceprint data. This state lives in the Docker data volume and is used only for automatic matching.

The plugin links both layers. A vault speaker profile may reference a gateway voiceprint speaker id, but the vault profile remains the source of truth for display names and user-facing aliases.

## Gateway Design

Gateway adds minimal proxy endpoints around the upstream Qwen3-ASR voiceprint APIs:

- `GET /voiceprints/speakers`
- `POST /voiceprints/speakers`
- `POST /voiceprints/speakers/:id/samples`
- `DELETE /voiceprints/speakers/:id`
- `GET /voiceprints/health`

Gateway configuration includes:

- `VOICEPRINT_ENABLED=true`
- `VOICEPRINT_DB_PATH=/data/voiceprints.sqlite3`
- `VOICEPRINT_MATCH_THRESHOLD=0.70`

The existing `/data` Docker volume persists the voiceprint sqlite database.

Gateway normalizes voiceprint match metadata when upstream returns it. Segment objects may include:

```json
{
  "speaker": "说话人2",
  "matched_speaker_id": "vp_abc",
  "matched_display_name": "Alice",
  "speaker_confidence": 0.88
}
```

Gateway does not replace temporary labels with display names. It returns candidates and confidence metadata; the plugin decides whether to apply them.

Gateway error handling:

- Voiceprint disabled returns `503` with a clear diagnostic message.
- Upstream voiceprint API failures return `502` with the upstream error summarized.
- Invalid or too-short sample audio returns `400` or a normalized upstream validation error.
- Deleting a gateway voiceprint speaker does not modify vault speaker profiles or historical notes.

## Plugin Design

The plugin adds a dedicated speaker workflow module.

Vault speaker profile:

```json
{
  "id": "vault-speaker-alice",
  "displayName": "Alice",
  "aliases": ["A", "产品经理"],
  "gatewaySpeakerId": "vp_abc",
  "createdAt": "2026-06-02T00:00:00",
  "updatedAt": "2026-06-02T00:00:00"
}
```

Meeting speaker map:

```json
{
  "说话人1": {
    "displayName": "Alice",
    "source": "auto_high_confidence",
    "confidence": 0.88,
    "gatewaySpeakerId": "vp_abc"
  },
  "说话人2": {
    "displayName": "Bob",
    "source": "manual"
  }
}
```

Persistence:

- Global speaker profiles are stored in `.local-transcription/speakers.json`.
- Meeting speaker maps are stored in note frontmatter under `local_transcription_speakers` when small enough.
- Large speaker maps are stored as a same-directory `.speaker-map.json` sidecar.
- Raw ASR JSON is preserved and is never overwritten by speaker rename or merge operations.

Plugin commands:

- `Local Transcription: Manage Speakers`
  - Create, rename, and delete vault speaker profiles.
  - Bind or unbind gateway voiceprint speaker ids.
  - Upload or record reference voiceprint audio.

- `Local Transcription: Review Speaker Mapping`
  - Review the current note or latest task.
  - Apply `说话人N -> displayName` mappings.
  - Merge temporary speaker labels.
  - Confirm or reject medium-confidence suggestions.
  - Explicitly add selected meeting audio segments as additional voiceprint samples.

Rendering:

- `speaker_timestamp` mode displays final display names when available.
- Original ASR labels are preserved in metadata.
- Manual user mappings override automatic matches.
- Re-rendering updates the transcript text without losing raw ASR JSON.

Example rendered line:

```text
[00:00:00 - 00:00:05] Alice: ...
```

## Voiceprint Confidence Policy

Voiceprint matching uses confidence bands:

- `confidence >= 0.85`: apply automatically to the draft transcript and record `autoMatched: true`.
- `0.65 <= confidence < 0.85`: show as a suggestion and require user confirmation.
- `confidence < 0.65`: keep the temporary label, such as `说话人3`.

User edits always win over automatic matching. If a user confirms `说话人3 -> Alice`, that mapping applies to the whole meeting. The plugin does not automatically add that meeting audio to Alice's voiceprint samples; a separate confirmation is required.

## Data Flow

1. User creates speaker profiles in the plugin.
2. User registers voiceprint samples by upload or recording.
3. Plugin sends samples to gateway voiceprint endpoints.
4. Gateway stores embeddings through upstream Qwen3-ASR voiceprint APIs in `/data/voiceprints.sqlite3`.
5. User transcribes meeting audio through `/jobs`.
6. Gateway returns normalized `segments` and `sentence_info`, optionally with voiceprint match metadata.
7. Plugin applies confidence policy and creates a draft speaker map.
8. Plugin renders the note with display names where allowed.
9. User reviews mappings, merges labels, or confirms suggestions.
10. Plugin re-renders the note and preserves raw ASR output.

## Mature Model Boundary

Default behavior continues to use upstream Qwen3-ASR, CAM++, FunASR, and Paraformer as provided by the current Docker image. This keeps the implementation deployable and avoids introducing research-only dependencies.

The design leaves adapter boundaries for future diarization backends:

- `campp` as the default.
- `nemo` as an optional mature backend.
- `pyannote` as an optional backend that requires explicit user token and license handling.

No new diarization backend is implemented in this stage.

## Testing

Unit tests:

- Gateway voiceprint proxy request and response normalization.
- Gateway voiceprint disabled and upstream failure behavior.
- Gateway segment normalization for `matched_speaker_id`, `matched_display_name`, and `speaker_confidence`.
- Plugin speaker profile CRUD.
- Plugin confidence policy.
- Plugin speaker rename and merge rendering.
- Plugin frontmatter and sidecar persistence.
- Plugin raw ASR preservation during re-render.

Integration tests:

- Fake gateway speaker registration.
- Fake gateway voiceprint sample upload.
- Transcription response with high-confidence match auto-applied.
- Medium-confidence match held for user confirmation.
- Manual confirmation followed by transcript re-render.

Manual Docker validation:

- AMI `ES2002a` 10-minute sample completes through `/jobs`.
- Response includes `segments` and `sentence_info`.
- Response includes at least two temporary speaker labels.
- User can map the temporary labels to the four AMI reference roles.
- A voiceprint speaker can be created from reference audio.
- Voiceprint database persists after gateway restart.
- ASR and voiceprint operations still idle-unload the backend and release VRAM.

Quality metrics:

- Track WER as an informational metric, not a hard gate.
- Track segment count, speaker count, keyword hits, and match confidence distribution.
- Diarization mistakes do not fail the stage if the plugin can correct them safely.

## Acceptance Criteria

- User can create and edit speaker profiles in the plugin.
- User can register voiceprint samples through the plugin.
- Gateway persists voiceprint data in the Docker data volume.
- Transcription output can carry voiceprint match candidates.
- High-confidence matches are applied automatically.
- Medium-confidence matches require confirmation.
- Low-confidence matches keep temporary speaker labels.
- User can rename and merge temporary speakers after transcription.
- Markdown output uses final display names.
- Original ASR JSON and original temporary speaker labels are preserved.
- Existing MVP behaviors still pass: `/jobs`, `/v1/audio/transcriptions`, structured segment output, Docker build, tests, model cache reuse, and idle VRAM release.

## Open Operational Notes

The downloaded AMI test sample files are large and should not be committed to git by default. The project should either keep them as local validation artifacts, add a download script, or use Git LFS if versioned test data becomes necessary.
