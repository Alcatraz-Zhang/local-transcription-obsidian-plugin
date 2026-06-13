from __future__ import annotations

import os
import sys


def _install_vllm_shutdown_patch() -> None:
    try:
        from gateway_app import qwen_child

        qwen_child._patch_vllm_engine_shutdown_cleanup()
    except Exception as exc:
        print(f"local transcription sitecustomize skipped vLLM shutdown patch: {exc}", file=sys.stderr, flush=True)


if os.getenv("LOCAL_TRANSCRIPTION_PATCH_VLLM_SHUTDOWN") == "1":
    _install_vllm_shutdown_patch()
