# Local Transcription

Local-first meeting transcription for Obsidian.

This project pairs an Obsidian plugin with a Dockerized GPU ASR gateway. Record or
upload audio in Obsidian, and the gateway transcribes it with speaker
diarization, timestamps, and optional voiceprint matching — all running on your
own hardware.

```text
Obsidian plugin
  -> http://localhost:17003
  -> FastAPI gateway container
      -> built-in WebUI
      -> Qwen3-ASR child process starts on demand
      -> CAM++ diarization and voiceprint matching
      -> idle timeout releases GPU memory
```

## Contents

- [Quick Start](#quick-start)
- [Install the Obsidian Plugin](#install-the-obsidian-plugin)
- [Use the Gateway](#use-the-gateway)
- [Features](#features)
- [Gateway API](#gateway-api)
- [Development](#development)
- [Publishing Images](#publishing-images)
- [Security Notes](#security-notes)

## Quick Start

### Requirements

- Docker Desktop or Docker Engine with the NVIDIA Container Toolkit.
- An NVIDIA GPU with a driver that can run CUDA 13 user-space images.
- Obsidian (desktop) for the plugin workflow.

### Start the gateway

```powershell
copy .env.example .env
docker compose up -d
```

The WebUI opens at `http://localhost:17003` (or the host port you mapped in
`.env`).

Check health:

```powershell
curl.exe http://localhost:17003/health
curl.exe http://localhost:17003/voiceprints/health
```

You can also run a pre-built image directly:

```powershell
docker run --rm --gpus all --init `
  -p 127.0.0.1:17003:17003 `
  -v local-transcription-hf:/root/.cache/huggingface `
  -v local-transcription-ms:/root/.cache/modelscope `
  -v local-transcription-data:/data `
  ghcr.io/alcatraz-zhang/local-transcription-obsidian-plugin-asr-gateway:0.2.1
```

## Install the Obsidian Plugin

1. Build or download the plugin files:

   ```text
   apps/obsidian-plugin/main.js
   apps/obsidian-plugin/manifest.json
   apps/obsidian-plugin/styles.css
   ```

2. In Obsidian, open **Settings → Community plugins**, disable Safe mode, then
   use **Open plugins folder** to create a folder named `local-transcription`.
3. Copy the three files above into that folder.
4. Enable **Local Transcription** in the Community plugins list.
5. Open the plugin settings and confirm the gateway URL
   (`http://localhost:17003` by default).

To build from source:

```powershell
npm install
npm run build
```

## Use the Gateway

### WebUI

Open `http://localhost:17003` to upload audio, watch job status, and manage
enrolled speakers.

### From Obsidian

- **Record**: click the microphone ribbon icon or run **Start transcription
  recording**, then **Stop and transcribe** when finished.
- **Upload**: right-click any supported audio file and choose
  **Transcribe audio file**.
- Supported formats include `mp3`, `m4a`, `wav`, `flac`, `aac`, and `ogg`.

### Transcript format

Generated notes look like:

```text
[00:00:00 - 00:00:05] Alice: ...
[00:00:06 - 00:00:12] Bob: ...
```

The raw structured ASR response is saved beside each note as `*.raw-asr.json`.

### Voiceprints

Voiceprint matching is enabled by default. Enroll speakers through the WebUI or
the plugin's speaker commands. Confidence is handled as follows:

- `>= 0.85`: the matched speaker profile is applied automatically.
- `0.65` to `< 0.85`: shown as a suggestion for you to confirm.
- `< 0.65`: keeps the temporary ASR speaker label.

Persist the `/data` volume if you want enrolled speakers to survive container
recreation.

## Features

- Local GPU inference via Qwen3-ASR and vLLM.
- Speaker diarization with CAM++.
- Persistent voiceprint matching (SQLite + sqlite-vec).
- Built-in WebUI for uploads and speaker management.
- OpenAI-compatible `/v1/audio/transcriptions` endpoint.
- Optional LLM post-processing for transcript cleanup.

## Gateway API

- `GET /` — WebUI
- `GET /health`
- `POST /jobs` — recommended for long audio
- `GET /jobs/{id}`
- `POST /v1/audio/transcriptions` — OpenAI-compatible
- `GET /voiceprints/health`
- `GET /voiceprints/speakers`
- `POST /voiceprints/speakers`
- `POST /voiceprints/speakers/{speaker_id}/samples`
- `DELETE /voiceprints/speakers/{speaker_id}`

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

## Development

```powershell
# Install dependencies
npm install

# Run all tests
npm run test

# Build the plugin
npm run build
```

Gateway-only tests:

```powershell
python -m pytest services/gateway/tests -q
```

Plugin-only tests:

```powershell
npm run test:plugin
```

Docker sanity checks:

```powershell
docker compose config --quiet
docker compose build asr-gateway
docker compose up -d asr-gateway
```

### Important runtime notes

- First start can be slow while models download and vLLM warms up.
  `ASR_READY_TIMEOUT` defaults to 30 minutes.
- `IDLE_TIMEOUT` (default 300s) stops the Qwen3-ASR child process to release
  VRAM.
- Audio shorter than `MIN_DIARIZATION_DURATION_SECONDS` (default 5s) uses a
  single-speaker fallback to avoid upstream diarization failures.
- Model caches are persisted in named volumes:
  `/root/.cache/huggingface` and `/root/.cache/modelscope`.

### Dependency pinning

The gateway stack is tightly coupled. Upgrade CUDA, PyTorch, vLLM, constraints,
and transcript samples as **one tested change**:

- Base image: `nvidia/cuda:13.0.2-cudnn-devel-ubuntu24.04`
- PyTorch CUDA index: `cu130`
- `torch==2.11.0`, `torchaudio==2.11.0`, `torchvision==0.26.0`
- `vllm[audio]==0.22.1`
- `uv==0.11.21`
- Qwen3-ASR source pinned to commit
  `8723468eaafa98bc571c52a15ec6e3770a0d517e`
- Python constraints: `services/gateway/python-constraints-cu130.txt`

## Publishing Images

A GitHub Action builds and pushes the gateway image to both GitHub Container
Registry (GHCR) and Docker Hub on every push to `main` and on version tags.

Published images:

```text
ghcr.io/alcatraz-zhang/local-transcription-obsidian-plugin-asr-gateway:0.2.1
ghcr.io/alcatraz-zhang/local-transcription-obsidian-plugin-asr-gateway:latest

alcatraz9527/local-transcription-obsidian-plugin-asr-gateway:0.2.1
alcatraz9527/local-transcription-obsidian-plugin-asr-gateway:latest
```

### Manual publish (fallback)

Build and tag locally:

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

Publish to Docker Hub:

```powershell
docker login
docker push alcatraz9527/local-transcription-obsidian-plugin-asr-gateway:0.2.1
docker push alcatraz9527/local-transcription-obsidian-plugin-asr-gateway:latest
```

The image includes OCI labels such as `org.opencontainers.image.source` so GHCR
can associate the package with this repository.

## Security Notes

- Post-processing API keys are stored through Obsidian `secretStorage`.
- `.env`, model caches, logs, generated data, and test artifacts are not
  committed.
- The gateway binds to localhost by default in Compose.
