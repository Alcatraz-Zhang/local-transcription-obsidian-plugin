# Obsidian Local ASR Gateway

Local-first Obsidian meeting transcription with a Dockerized ASR gateway, timestamped speaker output, long-audio jobs, and idle GPU release.

## Shape

```text
Obsidian plugin
  -> http://localhost:17002
  -> gateway container
      -> FastAPI gateway stays alive
      -> Qwen3-ASR child process starts on demand
      -> idle timeout terminates the child process to release VRAM
```

The Obsidian plugin owns recording/upload, audio file storage, note creation, templates, and external LLM post-processing. The gateway owns ASR job queueing, backend lifecycle, and stable transcript formatting.

## Development

```powershell
npm install
npm run test
npm run build
```

Gateway tests only:

```powershell
python -m pytest services/gateway/tests -q
```

Plugin tests only:

```powershell
npm run test:plugin
```

## Docker

```powershell
copy .env.example .env
docker compose build
docker compose up
```

Health check:

```powershell
curl.exe http://localhost:17002/health
```

Check GPU release around a job:

```powershell
nvidia-smi
curl.exe http://localhost:17002/health
nvidia-smi
```

After `IDLE_TIMEOUT`, the Qwen3-ASR child process should exit and VRAM should drop. The container itself remains running.

## Obsidian Plugin

Build output is written to:

```text
apps/obsidian-plugin/main.js
```

Install during development by copying these files into an Obsidian vault plugin folder:

```text
apps/obsidian-plugin/main.js
apps/obsidian-plugin/manifest.json
apps/obsidian-plugin/styles.css
```

Default note template:

```markdown
![[{{audioFile}}]]

{{transcription}}
```

Default transcript format:

```text
[00:00:00 - 00:00:05] Speaker1: ...
[00:00:06 - 00:00:12] Speaker2: ...
```

## API

- `GET /health`
- `POST /jobs`
- `GET /jobs/:id`
- `POST /v1/audio/transcriptions`

`/jobs` is the primary long-audio path for the plugin. `/v1/audio/transcriptions` is kept for OpenAI-compatible clients.

## Notes

- MVP builds on `quantatrisk/qwen3-asr:gpu-latest`; the gateway/package boundary was designed against upstream commit `8723468eaafa98bc571c52a15ec6e3770a0d517e`.
- Word-level timestamps are intentionally off by default. Segment-level timestamps plus speaker labels are the default meeting transcript format.
- Post-processing API keys are stored through Obsidian `secretStorage`, not in `data.json`.
