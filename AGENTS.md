# Agent Instructions

Repo-specific guidance for working in `local-transcription-obsidian-plugin`.

## Project Shape

- npm workspace with a single workspace: `apps/obsidian-plugin`.
- Two runtimes: a TypeScript Obsidian plugin and a Python FastAPI ASR gateway in `services/gateway/`.
- Version is kept in sync across root `package.json`, plugin `package.json`, plugin `manifest.json`, gateway `pyproject.toml`, Dockerfile, and `docker-compose.yml`.

## Daily Commands

```powershell
# Install dependencies
npm install

# Build the plugin (typecheck + esbundle)
npm run build

# Watch build
npm run dev -w @local-transcription/obsidian-plugin

# Run all tests
npm run test

# Run just the plugin tests
npm run test:plugin

# Run just the gateway tests
npm run test:gateway   # equivalent to: python -m pytest services/gateway/tests -q
```

Gateway tests depend on `pytest` and the gateway deps. There is no `pytest.ini` requirement beyond `pythonpath = services/gateway`.

## Obsidian Plugin

- Entry point: `apps/obsidian-plugin/src/main.ts`.
- Build output: `apps/obsidian-plugin/main.js` (CJS bundle).
- Obsidian loads `main.js`, `manifest.json`, and `styles.css` from the plugin directory.
- TypeScript targets ES2022 with `moduleResolution: bundler`, `strictNullChecks: true`, and `isolatedModules: true`.
- Tests use **vitest** with heavy mocking of the `obsidian` API; they are unit tests, not integration tests against Obsidian.
- `esbuild.config.mjs` externalizes `obsidian`, `electron`, all CodeMirror packages, and Node builtins.

## Gateway

- FastAPI app lives in `services/gateway/gateway_app/`.
- Entry point: `python -m gateway_app` (uvicorn), default port `17003`.
- Requires an NVIDIA GPU and the NVIDIA Container Toolkit. Local dev uses Docker Compose:

  ```powershell
  copy .env.example .env
  docker compose up -d
  ```

- Health checks:

  ```powershell
  curl.exe http://localhost:17003/health
  curl.exe http://localhost:17003/voiceprints/health
  ```

- The gateway serves both the API and a built-in WebUI from port `17003`.

## Dependency Pinning (Do Not Bump Casually)

The gateway has a tightly coupled GPU stack. Upgrade CUDA, PyTorch, vLLM, constraints, and transcript samples as **one tested change**:

- Base image: `nvidia/cuda:13.0.2-cudnn-devel-ubuntu24.04`
- PyTorch CUDA index: `cu130`
- `torch==2.11.0`, `torchaudio==2.11.0`, `torchvision==0.26.0`
- `vllm[audio]==0.22.1`
- `uv==0.11.21`
- Qwen3-ASR source pinned to commit `8723468eaafa98bc571c52a15ec6e3770a0d517e`
- Python constraints: `services/gateway/python-constraints-cu130.txt`

## Runtime Behavior Worth Knowing

- First container start can be slow while models download and vLLM warms up. `ASR_READY_TIMEOUT` defaults to 30 minutes.
- `IDLE_TIMEOUT` (default 300s) kills the Qwen3-ASR child process to release VRAM.
- Short audio below `MIN_DIARIZATION_DURATION_SECONDS` (default 5s) uses a single-speaker fallback.
- Model caches persist in named volumes: `/root/.cache/huggingface` and `/root/.cache/modelscope`.
- Voiceprint DB path defaults to `/data/voiceprints.sqlite3`; persist `/data` if you want enrolled speakers to survive container recreation.

## Plugin Domain Conventions

- Plugin ID is `local-transcription`; the plugin is desktop-only (`isDesktopOnly: true`).
- Default gateway URL: `http://localhost:17003`.
- Speaker confidence thresholds:
  - `>= 0.85`: auto-apply the matched speaker profile.
  - `0.65` to `< 0.85`: keep as a suggestion.
  - `< 0.65`: keep the temporary ASR speaker label.
- Speaker frontmatter is written inline unless it exceeds 4KB, in which case it moves to a `.speaker-map.json` sidecar.
- Generated notes preserve the raw ASR response beside them as `*.raw-asr.json`.
- The default post-processing prompt is in Chinese and is tuned for cleaning transcripts, not summarizing them.
- Post-processing API keys are stored via Obsidian `secretStorage` with ID `local-transcription-post-processing-api-key`.

## Ignored / Generated Paths

- `node_modules/`, `dist/`, `.venv/`, `__pycache__/`, `.pytest_cache/`
- `.env`, `models/`, `logs/`, `temp/`, `tmp/`, `data/`, `*.egg-info/`
- `.worktrees/`, `.omo/`, `graphify-out/`

Test artifacts go under `tmp/` by convention and must not be committed.

## Testing Notes

- Plugin tests run with `vitest run` and mock `obsidian`; do not expect real Obsidian APIs.
- Gateway tests use `pytest` and do not require a running container for the core suite.
- Production audio validation samples live in `transcript_test_samples/`.
