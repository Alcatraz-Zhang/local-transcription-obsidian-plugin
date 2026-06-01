from __future__ import annotations

import os
import runpy
from pathlib import Path


def _ensure_modelscope_compat_link(model_root: Path) -> None:
    cache_root = Path(os.getenv("MODELSCOPE_CACHE") or "/root/.cache/modelscope")
    legacy_root = cache_root / "hub" / "models"
    if legacy_root == model_root or legacy_root.exists():
        return
    legacy_root.parent.mkdir(parents=True, exist_ok=True)
    legacy_root.symlink_to(model_root, target_is_directory=True)


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

    runpy.run_path("/app/start.py", run_name="__main__")


if __name__ == "__main__":
    main()
