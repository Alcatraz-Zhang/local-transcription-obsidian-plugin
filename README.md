# Local Transcription

Local-first meeting transcription for Obsidian. The project ships an Obsidian
plugin plus a GPU ASR gateway container with Qwen3-ASR, CAM++ diarization,
speaker timestamps, a built-in WebUI, and a persistent voiceprint database.

## Quick Start

Requirements:

- Docker Desktop or Docker Engine with NVIDIA Container Toolkit.
- An NVIDIA GPU with a recent driver that can run CUDA 13 user-space images.
- Obsidian for the plugin workflow.

Run the gateway locally:

```powershell
copy .env.example .env
docker compose up -d
```

Open the container WebUI:

```text
http://localhost:17003
```

Check health:

```powershell
curl.exe http://localhost:17003/health
curl.exe http://localhost:17003/voiceprints/health
```

The default Compose mapping is `127.0.0.1:17003:17003`: the left side is the
host port, and the right side is the container port. If you map
`127.0.0.1:10001:17003`, open `http://localhost:10001`.

## Published Images

The ASR gateway image is versioned as `0.2.1`.

```text
ghcr.io/alcatraz-zhang/local-transcription-obsidian-plugin-asr-gateway:0.2.1
ghcr.io/alcatraz-zhang/local-transcription-obsidian-plugin-asr-gateway:latest

alcatraz9527/local-transcription-obsidian-plugin-asr-gateway:0.2.1
alcatraz9527/local-transcription-obsidian-plugin-asr-gateway:latest
```

Run a published image directly:

```powershell
docker run --rm --gpus all --init `
  -p 127.0.0.1:17003:17003 `
  -v local-transcription-hf:/root/.cache/huggingface `
  -v local-transcription-ms:/root/.cache/modelscope `
  -v local-transcription-data:/data `
  ghcr.io/alcatraz-zhang/local-transcription-obsidian-plugin-asr-gateway:0.2.1
```

The container serves both the transcription API and the WebUI from port `17003`.

## Architecture

```text
Obsidian plugin
  -> http://localhost:17003
  -> FastAPI gateway container
      -> built-in WebUI
      -> Qwen3-ASR child process starts on demand
      -> CAM++ diarization and voiceprint matching
      -> idle timeout releases GPU memory
```

The plugin owns recording/upload, transcript note rendering, speaker profile
aliases, templates, and optional post-processing. The gateway owns job queueing,
backend lifecycle, API normalization, WebUI delivery, and voiceprint API proxying.

## Obsidian Plugin

Build output:

```text
apps/obsidian-plugin/main.js
```

Development install files:

```text
apps/obsidian-plugin/main.js
apps/obsidian-plugin/manifest.json
apps/obsidian-plugin/styles.css
```

Default transcript note format:

```text
[00:00:00 - 00:00:05] Speaker1: ...
[00:00:06 - 00:00:12] Speaker2: ...
```

The raw structured ASR response is preserved beside generated notes as
`*.raw-asr.json`.

## Gateway API

- `GET /`
- `GET /health`
- `POST /jobs`
- `GET /jobs/{id}`
- `POST /v1/audio/transcriptions`
- `GET /voiceprints/health`
- `GET /voiceprints/speakers`
- `POST /voiceprints/speakers`
- `POST /voiceprints/speakers/{speaker_id}/samples`
- `DELETE /voiceprints/speakers/{speaker_id}`

`/jobs` is the recommended long-audio path. `/v1/audio/transcriptions` exists
for OpenAI-compatible clients.

Normalized responses include stable `segments` and `sentence_info` fields:

```json
{
  "text": "transcript text",
  "segments": [
    { "start": 0.0, "end": 5.0, "speaker": "Speaker1", "text": "..." }
  ],
  "sentence_info": [
    { "start": 0.0, "end": 5.0, "speaker": "Speaker1", "text": "..." }
  ]
}
```

## Voiceprints

Voiceprint matching is enabled by default:

```text
VOICEPRINT_ENABLED=true
VOICEPRINT_DB_PATH=/data/voiceprints.sqlite3
VOICEPRINT_MATCH_THRESHOLD=0.70
```

The upstream Qwen3-ASR service owns the SQLite/sqlite-vec schema and embedding
writes. The gateway reports database health and proxies registration/list/delete
requests. Keep `/data` on a Docker volume if you want enrolled speakers to
survive container recreation.

Plugin-side confidence handling:

- `>= 0.85`: auto-apply the matched speaker profile.
- `0.65` to `< 0.85`: keep as a suggestion.
- `< 0.65`: keep the temporary ASR speaker label.

## Runtime Notes

- First backend start can be slow while models download and vLLM warms up.
- `IDLE_TIMEOUT` controls when the Qwen3-ASR child process exits to release VRAM.
- Short WAV files below `MIN_DIARIZATION_DURATION_SECONDS` use a gateway
  single-speaker fallback to avoid upstream short-audio diarization failures.
- Model caches are persisted in Docker volumes:
  `/root/.cache/huggingface` and `/root/.cache/modelscope`.

## Development

```powershell
npm install
npm run test
npm run build
```

Gateway tests:

```powershell
python -m pytest services/gateway/tests -q
```

Plugin tests:

```powershell
npm run test:plugin
```

Docker checks:

```powershell
docker compose config --quiet
docker compose build asr-gateway
docker compose up -d asr-gateway
```

## Dependency Pinning

- The gateway starts from pinned
  `nvidia/cuda:13.0.2-cudnn-devel-ubuntu24.04`.
- Qwen3-ASR source is pinned to
  `Quantatirsk/qwen3-asr@8723468eaafa98bc571c52a15ec6e3770a0d517e`.
- Python constraints live in
  `services/gateway/python-constraints-cu130.txt`.
- Explicit runtime pins include `torch==2.11.0`, `torchaudio==2.11.0`,
  `torchvision==0.26.0`, `vllm[audio]==0.22.1`, and `uv==0.11.21`.
- Plugin dependencies are pinned through `package-lock.json`.

Do not move dependency versions casually. Upgrade CUDA, PyTorch, vLLM,
constraints, and transcript samples as one tested change.

## Production Test Evidence

The current release candidate was tested with:

- LibriSpeech short English WAV.
- Chinese speech MP3.
- A real 324 second meeting M4A.
- AMI ES2002a first 10 minutes.
- AMI ES2002a full mixed-headset WAV.
- A 1291 second stereo War and Peace MP3.

Voiceprint validation covered registration, SQLite persistence across container
restart, cleanup, and a positive match where a registered Chinese sample was
recognized as `ProdTest_Chinese`.

Test artifacts are generated under `tmp/` and are intentionally ignored by Git.

## Publishing

Build and tag the gateway:

```powershell
docker build -t local-transcription:0.2.1 ./services/gateway
docker tag local-transcription:0.2.1 ghcr.io/alcatraz-zhang/local-transcription-obsidian-plugin-asr-gateway:0.2.1
docker tag local-transcription:0.2.1 ghcr.io/alcatraz-zhang/local-transcription-obsidian-plugin-asr-gateway:latest
docker tag local-transcription:0.2.1 alcatraz9527/local-transcription-obsidian-plugin-asr-gateway:0.2.1
docker tag local-transcription:0.2.1 alcatraz9527/local-transcription-obsidian-plugin-asr-gateway:latest
```

Publish to GHCR:

```powershell
gh auth token | docker login ghcr.io -u Alcatraz-Zhang --password-stdin
docker push ghcr.io/alcatraz-zhang/local-transcription-obsidian-plugin-asr-gateway:0.2.1
docker push ghcr.io/alcatraz-zhang/local-transcription-obsidian-plugin-asr-gateway:latest
```

Publish to Docker Hub after logging in with an account that owns the namespace:

```powershell
docker login
docker push alcatraz9527/local-transcription-obsidian-plugin-asr-gateway:0.2.1
docker push alcatraz9527/local-transcription-obsidian-plugin-asr-gateway:latest
```

The image includes OCI labels such as `org.opencontainers.image.source` so GHCR
can associate the package with this repository.

## Security Notes

- API keys for post-processing are stored through Obsidian `secretStorage`.
- `.env`, model caches, logs, generated data, and production test artifacts are
  not committed.
- The gateway binds to localhost by default in Compose.
