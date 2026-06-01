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

The Obsidian plugin owns recording/upload, audio file storage, transcript formatting, note creation, templates, and external LLM post-processing. The gateway owns ASR job queueing, backend lifecycle, and stable `segments` / `sentence_info` normalization.

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

Test audio lives in `transcript_test_samples/`:

- `english_librispeech_6930-75918-0000.wav` for quick English smoke tests.
- `chinese_speech_dataset_chinese.mp3` for quick Chinese smoke tests.
- `long_warandpeacevolume2_71_tolstoy.mp3` for long-audio/manual queue tests.

The matching `.txt` files are expected-text references for manual ASR quality checks; unit tests do not load the ASR model.

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

First-time model download can be slow. Increase `ASR_READY_TIMEOUT` in `.env` if the backend is still downloading or loading models when readiness expires.

Model caches are persisted in Docker volumes. Hugging Face models live under
`/root/.cache/huggingface`, and ModelScope models live under
`/root/.cache/modelscope/models/{model_id}`. The gateway starts Qwen3-ASR
through a small wrapper so Qwen's internal model integrity checks use the same
ModelScope cache layout that the installed SDK writes.

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

The gateway does not inject this formatted transcript into `text`. It returns structured segment data, and the plugin renders the final note according to the selected output mode.

## API

- `GET /health`
- `POST /jobs`
- `GET /jobs/:id`
- `POST /v1/audio/transcriptions`

`/jobs` is the primary long-audio path for the plugin. `/v1/audio/transcriptions` is kept for OpenAI-compatible clients.

Gateway responses preserve structured transcript data:

```json
{
  "text": "raw backend text if provided",
  "segments": [
    { "start": 0.0, "end": 5.0, "speaker": "Speaker1", "text": "..." }
  ],
  "sentence_info": [
    { "start": 0.0, "end": 5.0, "speaker": "Speaker1", "text": "..." }
  ]
}
```

## Notes

- MVP builds on `quantatrisk/qwen3-asr:gpu-latest`; the gateway/package boundary was designed against upstream commit `8723468eaafa98bc571c52a15ec6e3770a0d517e`.
- Word-level timestamps are intentionally off by default. Segment-level timestamps plus speaker labels are the default meeting transcript format.
- Post-processing API keys are stored through Obsidian `secretStorage`, not in `data.json`.
