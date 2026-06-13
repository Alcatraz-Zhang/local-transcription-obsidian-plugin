from __future__ import annotations

import json
import os
import atexit
import runpy
import signal
import sys
from pathlib import Path
from typing import Callable

from .env import env_bool

FORCED_ALIGNER_REPO = "Qwen/Qwen3-ForcedAligner-0.6B"
FORCED_ALIGNER_REQUIRED_FILE = "snapshots/*/model.safetensors"
PATCHED_MODELS_CONFIG = "/tmp/local-transcription-models.no-forced-aligner.json"
_MANAGED_SHUTDOWN_REQUESTED = False


def _set_default_env(name: str, value: str) -> None:
    if not os.getenv(name):
        os.environ[name] = value


def _apply_runtime_defaults() -> None:
    _set_default_env("VLLM_WORKER_MULTIPROC_METHOD", "spawn")
    _set_default_env("HF_HUB_DISABLE_XET", "1")
    _set_default_env("VOICEPRINT_ENABLED", "true")
    _set_default_env("VOICEPRINT_DB_PATH", "/data/voiceprints.sqlite3")
    _set_default_env("VOICEPRINT_MATCH_THRESHOLD", "0.70")
    _set_default_env("LOCAL_TRANSCRIPTION_PATCH_VLLM_SHUTDOWN", "1")

    voiceprint_db_path = Path(os.environ["VOICEPRINT_DB_PATH"])
    voiceprint_db_path.parent.mkdir(parents=True, exist_ok=True)


def _patch_auto_model_disable_update(auto_model_cls: type) -> bool:
    if getattr(auto_model_cls, "_local_transcription_disable_update_patch", False):
        return False

    original_init = auto_model_cls.__init__

    def patched_init(self: object, *args: object, **kwargs: object) -> None:
        kwargs.setdefault("disable_update", True)
        original_init(self, *args, **kwargs)

    auto_model_cls.__init__ = patched_init  # type: ignore[method-assign]
    setattr(auto_model_cls, "_local_transcription_disable_update_patch", True)
    return True


def _patch_funasr_update_check() -> bool:
    try:
        from funasr import AutoModel
    except Exception:
        return False
    return _patch_auto_model_disable_update(AutoModel)


def _cleanup_vllm_distributed_environment() -> None:
    try:
        from vllm.distributed.parallel_state import cleanup_dist_env_and_memory

        cleanup_dist_env_and_memory(shutdown_ray=False)
    except Exception as exc:
        print(f"vLLM distributed cleanup skipped: {exc}", file=sys.stderr, flush=True)


def _mark_managed_shutdown(signum: int | None = None, frame: object | None = None) -> None:
    global _MANAGED_SHUTDOWN_REQUESTED
    _MANAGED_SHUTDOWN_REQUESTED = True


def _install_managed_shutdown_signal() -> bool:
    managed_signal = getattr(signal, "SIGUSR1", None)
    if managed_signal is None:
        return False
    try:
        signal.signal(managed_signal, _mark_managed_shutdown)
        return True
    except Exception:
        return False


def _patch_vllm_engine_shutdown_cleanup(
    engine_core_cls: type | None = None,
    cleanup: Callable[[], None] = _cleanup_vllm_distributed_environment,
) -> bool:
    if engine_core_cls is None:
        try:
            from vllm.v1.engine.core import EngineCore as engine_core_cls
        except Exception:
            return False

    if getattr(engine_core_cls, "_local_transcription_shutdown_cleanup_patch", False):
        return False

    original_shutdown = engine_core_cls.shutdown

    def patched_shutdown(self: object, *args: object, **kwargs: object) -> object:
        try:
            return original_shutdown(self, *args, **kwargs)
        finally:
            cleanup()

    engine_core_cls.shutdown = patched_shutdown  # type: ignore[method-assign]
    setattr(engine_core_cls, "_local_transcription_shutdown_cleanup_patch", True)
    return True


def _refresh_process_exitcode(process: object) -> None:
    join = getattr(process, "join", None)
    if callable(join):
        try:
            join(timeout=0)
        except Exception:
            pass


def _expected_vllm_engine_exit(process: object) -> bool:
    _refresh_process_exitcode(process)
    if _MANAGED_SHUTDOWN_REQUESTED:
        return True
    return getattr(process, "exitcode", None) in {
        0,
        -signal.SIGINT,
        -signal.SIGTERM,
    }


def _patch_vllm_core_client_expected_exit(
    mp_client_cls: type | None = None,
    core_client_module: object | None = None,
    connection_wait: Callable[[list[object]], list[object]] | None = None,
) -> bool:
    if mp_client_cls is None or core_client_module is None:
        try:
            from vllm.v1.engine import core_client as core_client_module

            mp_client_cls = core_client_module.MPClient
        except Exception:
            return False

    if connection_wait is None:
        module_multiprocessing = getattr(core_client_module, "multiprocessing", None)
        module_connection = getattr(module_multiprocessing, "connection", None)
        connection_wait = getattr(module_connection, "wait", None)
        if connection_wait is None:
            from multiprocessing.connection import wait as connection_wait

    if getattr(mp_client_cls, "_local_transcription_expected_exit_patch", False):
        return False

    def patched_start_engine_core_monitor(self: object) -> None:
        engine_manager = self.resources.engine_manager
        if (
            engine_manager is None
            or not hasattr(engine_manager, "processes")
            or not engine_manager.processes
        ):
            return

        engine_processes = engine_manager.processes
        self_ref = core_client_module.weakref.ref(self)

        def monitor_engine_cores() -> None:
            sentinels = [proc.sentinel for proc in engine_processes]
            died = connection_wait(sentinels)
            current_self = self_ref()
            if (
                not current_self
                or not current_self._finalizer.alive
                or current_self.resources.engine_dead
            ):
                return

            proc = next(proc for proc in engine_processes if proc.sentinel == died[0])
            if _expected_vllm_engine_exit(proc):
                core_client_module.logger.info(
                    "Engine core proc %s exited after normal shutdown.",
                    proc.name,
                )
                current_self.shutdown()
                return

            current_self.resources.engine_dead = True
            core_client_module.logger.error(
                "Engine core proc %s died unexpectedly, shutting down client.",
                proc.name,
            )
            current_self.shutdown()

        core_client_module.Thread(
            target=monitor_engine_cores,
            daemon=True,
            name="MPClientEngineMonitor",
        ).start()

    mp_client_cls.start_engine_core_monitor = patched_start_engine_core_monitor  # type: ignore[method-assign]
    setattr(mp_client_cls, "_local_transcription_expected_exit_patch", True)
    return True


def _shutdown_llm_object(llm: object | None) -> bool:
    if llm is None:
        return False

    shutdown = getattr(llm, "shutdown", None)
    if callable(shutdown):
        shutdown()
        return True

    llm_engine = getattr(llm, "llm_engine", None)
    shutdown = getattr(llm_engine, "shutdown", None)
    if callable(shutdown):
        shutdown()
        return True

    return False


def _shutdown_runtime_vllm_engines(runtime_router: object | None) -> int:
    shared_engines = getattr(runtime_router, "_shared_engines", None)
    if not isinstance(shared_engines, dict):
        return 0

    shutdown_count = 0
    seen: set[int] = set()
    for engine in shared_engines.values():
        backend = getattr(engine, "model", None)
        for llm in (
            getattr(backend, "_forced_aligner", None),
            getattr(backend, "_llm", None),
        ):
            if llm is None or id(llm) in seen:
                continue
            seen.add(id(llm))
            try:
                if _shutdown_llm_object(llm):
                    shutdown_count += 1
            except Exception as exc:
                print(f"vLLM engine shutdown skipped: {exc}", file=sys.stderr, flush=True)
    return shutdown_count


def _install_runtime_vllm_shutdown_hook() -> None:
    def shutdown_loaded_engines() -> None:
        try:
            from app.services.asr.runtime import router as runtime_router_module

            _shutdown_runtime_vllm_engines(getattr(runtime_router_module, "_runtime_router", None))
        except Exception as exc:
            print(f"Runtime vLLM shutdown skipped: {exc}", file=sys.stderr, flush=True)

    atexit.register(shutdown_loaded_engines)


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
    _apply_runtime_defaults()
    _patch_funasr_update_check()
    _patch_vllm_engine_shutdown_cleanup()
    _patch_vllm_core_client_expected_exit()
    _install_managed_shutdown_signal()
    _install_runtime_vllm_shutdown_hook()

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

    if env_bool("ENABLE_FORCED_ALIGNER", False):
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
