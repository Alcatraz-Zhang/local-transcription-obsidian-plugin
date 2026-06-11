from __future__ import annotations

import json
import os
import runpy
from pathlib import Path
from typing import Callable


FORCED_ALIGNER_REPO = "Qwen/Qwen3-ForcedAligner-0.6B"
FORCED_ALIGNER_REQUIRED_FILE = "snapshots/*/model.safetensors"
PATCHED_MODELS_CONFIG = "/tmp/local-transcription-models.no-forced-aligner.json"


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _ensure_modelscope_compat_link(model_root: Path) -> None:
    cache_root = Path(os.getenv("MODELSCOPE_CACHE") or "/root/.cache/modelscope")
    legacy_root = cache_root / "hub" / "models"
    if legacy_root == model_root or legacy_root.exists():
        return
    legacy_root.parent.mkdir(parents=True, exist_ok=True)
    legacy_root.symlink_to(model_root, target_is_directory=True)


def _hf_repo_cache_dir(hf_home: Path, repo_id: str) -> Path:
    return hf_home / "hub" / f"models--{repo_id.replace('/', '--')}"


def _ensure_hf_snapshot_file(
    repo_id: str,
    required_glob: str,
    *,
    hf_home: Path,
    snapshot_download: Callable[..., str] | None = None,
) -> bool:
    repo_cache = _hf_repo_cache_dir(hf_home, repo_id)
    if any(repo_cache.glob(required_glob)):
        return False

    if snapshot_download is None:
        try:
            from huggingface_hub import snapshot_download as snapshot_download
        except Exception as exc:
            raise RuntimeError(f"Cannot verify or download required Hugging Face model {repo_id}: {exc}") from exc

    download_kwargs = {
        "repo_id": repo_id,
        "cache_dir": str(hf_home / "hub"),
        "resume_download": True,
    }
    try:
        snapshot_download(**download_kwargs)
    except TypeError as exc:
        if "resume_download" not in str(exc):
            raise
        download_kwargs.pop("resume_download")
        snapshot_download(**download_kwargs)

    if not any(repo_cache.glob(required_glob)):
        raise RuntimeError(
            f"Required Hugging Face model file is missing after download: "
            f"repo={repo_id}, missing={required_glob}, path={repo_cache}"
        )
    return True


def _write_models_config_without_forced_aligner(source: Path, target: Path) -> bool:
    config = json.loads(source.read_text(encoding="utf-8"))
    changed = False
    for model_config in config.get("models", {}).values():
        extra_kwargs = model_config.get("extra_kwargs")
        if isinstance(extra_kwargs, dict) and "forced_aligner_path" in extra_kwargs:
            extra_kwargs.pop("forced_aligner_path")
            changed = True

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(config, ensure_ascii=False, indent=4) + "\n", encoding="utf-8")
    return changed


def _set_models_config_path(settings: object, config_path: Path) -> None:
    setattr(settings, "ASR_MODELS_CONFIG", str(config_path))


def main() -> None:
    from app.core.config import settings

    try:
        from modelscope.utils.file_utils import get_model_cache_root

        default_model_root = get_model_cache_root()
    except Exception:
        default_model_root = "/root/.cache/modelscope/models"

    model_root = (os.getenv("MODELSCOPE_PATH") or default_model_root).strip()
    if model_root:
        model_root_path = Path(model_root)
        model_root_path.mkdir(parents=True, exist_ok=True)
        _ensure_modelscope_compat_link(model_root_path)
        settings.MODELSCOPE_PATH = str(model_root_path)

    if _env_bool("ENABLE_FORCED_ALIGNER", False):
        hf_home = Path(os.getenv("HF_HOME") or "/root/.cache/huggingface")
        _ensure_hf_snapshot_file(FORCED_ALIGNER_REPO, FORCED_ALIGNER_REQUIRED_FILE, hf_home=hf_home)
    else:
        patched_config_path = Path(os.getenv("PATCHED_MODELS_CONFIG") or PATCHED_MODELS_CONFIG)
        _write_models_config_without_forced_aligner(Path(settings.models_config_path), patched_config_path)
        _set_models_config_path(settings, patched_config_path)
        print(
            "Qwen forced aligner disabled; set ENABLE_FORCED_ALIGNER=true to enable word timestamps.",
            flush=True,
        )

    runpy.run_path("/app/start.py", run_name="__main__")


if __name__ == "__main__":
    main()
