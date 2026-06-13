from pathlib import Path
import json
import types
import weakref

import pytest

from gateway_app import qwen_child


def forced_aligner_file(hf_home: Path) -> Path:
    return (
        hf_home
        / "hub"
        / "models--Qwen--Qwen3-ForcedAligner-0.6B"
        / "snapshots"
        / "abc123"
        / "model.safetensors"
    )


def test_hf_snapshot_prefetch_skips_complete_cache(tmp_path):
    model_file = forced_aligner_file(tmp_path)
    model_file.parent.mkdir(parents=True)
    model_file.write_bytes(b"weights")
    calls = []

    downloaded = qwen_child._ensure_hf_snapshot_file(
        "Qwen/Qwen3-ForcedAligner-0.6B",
        "snapshots/*/model.safetensors",
        hf_home=tmp_path,
        snapshot_download=lambda **kwargs: calls.append(kwargs),
    )

    assert downloaded is False
    assert calls == []


def test_hf_snapshot_prefetch_downloads_missing_cache(tmp_path):
    calls = []

    def fake_snapshot_download(**kwargs):
        calls.append(kwargs)
        model_file = forced_aligner_file(tmp_path)
        model_file.parent.mkdir(parents=True)
        model_file.write_bytes(b"weights")
        return str(model_file.parent)

    downloaded = qwen_child._ensure_hf_snapshot_file(
        "Qwen/Qwen3-ForcedAligner-0.6B",
        "snapshots/*/model.safetensors",
        hf_home=tmp_path,
        snapshot_download=fake_snapshot_download,
    )

    assert downloaded is True
    assert calls == [
        {
            "repo_id": "Qwen/Qwen3-ForcedAligner-0.6B",
            "cache_dir": str(tmp_path / "hub"),
            "resume_download": True,
        }
    ]


def test_hf_snapshot_prefetch_supports_downloaders_without_resume_download(tmp_path):
    calls = []

    def fake_snapshot_download(**kwargs):
        calls.append(kwargs)
        if "resume_download" in kwargs:
            raise TypeError("resume_download is not supported")
        model_file = forced_aligner_file(tmp_path)
        model_file.parent.mkdir(parents=True)
        model_file.write_bytes(b"weights")
        return str(model_file.parent)

    downloaded = qwen_child._ensure_hf_snapshot_file(
        "Qwen/Qwen3-ForcedAligner-0.6B",
        "snapshots/*/model.safetensors",
        hf_home=tmp_path,
        snapshot_download=fake_snapshot_download,
    )

    assert downloaded is True
    assert calls == [
        {
            "repo_id": "Qwen/Qwen3-ForcedAligner-0.6B",
            "cache_dir": str(tmp_path / "hub"),
            "resume_download": True,
        },
        {
            "repo_id": "Qwen/Qwen3-ForcedAligner-0.6B",
            "cache_dir": str(tmp_path / "hub"),
        },
    ]


def test_hf_snapshot_prefetch_raises_when_required_file_still_missing(tmp_path):
    with pytest.raises(RuntimeError, match="Qwen/Qwen3-ForcedAligner-0.6B.*model.safetensors"):
        qwen_child._ensure_hf_snapshot_file(
            "Qwen/Qwen3-ForcedAligner-0.6B",
            "snapshots/*/model.safetensors",
            hf_home=tmp_path,
            snapshot_download=lambda **kwargs: "missing",
        )


def test_forced_aligner_patch_removes_runtime_dependency_without_mutating_source(tmp_path):
    source = tmp_path / "models.json"
    target = tmp_path / "models.no-forced-aligner.json"
    original = {
        "models": {
            "qwen3-asr-0.6b": {
                "name": "Qwen",
                "engine": "qwen3",
                "models": {"offline": "Qwen/Qwen3-ASR-0.6B"},
                "extra_kwargs": {
                    "forced_aligner_path": "Qwen/Qwen3-ForcedAligner-0.6B",
                    "max_model_len": 16384,
                },
            },
            "paraformer-large": {
                "name": "Paraformer",
                "engine": "funasr",
                "models": {"realtime": "iic/paraformer"},
            },
        }
    }
    source.write_text(json.dumps(original), encoding="utf-8")

    changed = qwen_child._write_models_config_without_forced_aligner(source, target)

    assert changed is True
    assert json.loads(source.read_text(encoding="utf-8")) == original
    patched = json.loads(target.read_text(encoding="utf-8"))
    qwen_kwargs = patched["models"]["qwen3-asr-0.6b"]["extra_kwargs"]
    assert "forced_aligner_path" not in qwen_kwargs
    assert qwen_kwargs["max_model_len"] == 16384
    assert patched["models"]["paraformer-large"] == original["models"]["paraformer-large"]


def test_set_models_config_path_updates_backing_setting(tmp_path):
    class FakeSettings:
        ASR_MODELS_CONFIG = "app/services/asr/models.json"

        @property
        def models_config_path(self):
            return self.ASR_MODELS_CONFIG

    settings = FakeSettings()
    patched_config = tmp_path / "patched-models.json"

    qwen_child._set_models_config_path(settings, patched_config)

    assert settings.models_config_path == str(patched_config)


def test_runtime_defaults_enable_spawn_xet_and_voiceprints(monkeypatch, tmp_path):
    db_path = tmp_path / "voiceprints" / "voiceprints.sqlite3"
    for name in (
        "VLLM_WORKER_MULTIPROC_METHOD",
        "HF_HUB_DISABLE_XET",
        "VOICEPRINT_ENABLED",
        "VOICEPRINT_MATCH_THRESHOLD",
        "LOCAL_TRANSCRIPTION_PATCH_VLLM_SHUTDOWN",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("VOICEPRINT_DB_PATH", str(db_path))

    qwen_child._apply_runtime_defaults()

    assert qwen_child.os.environ["VLLM_WORKER_MULTIPROC_METHOD"] == "spawn"
    assert qwen_child.os.environ["HF_HUB_DISABLE_XET"] == "1"
    assert qwen_child.os.environ["VOICEPRINT_ENABLED"] == "true"
    assert qwen_child.os.environ["VOICEPRINT_DB_PATH"] == str(db_path)
    assert qwen_child.os.environ["VOICEPRINT_MATCH_THRESHOLD"] == "0.70"
    assert qwen_child.os.environ["LOCAL_TRANSCRIPTION_PATCH_VLLM_SHUTDOWN"] == "1"
    assert db_path.parent.exists()


def test_runtime_defaults_do_not_override_explicit_values(monkeypatch, tmp_path):
    db_path = tmp_path / "custom.sqlite3"
    monkeypatch.setenv("VLLM_WORKER_MULTIPROC_METHOD", "forkserver")
    monkeypatch.setenv("HF_HUB_DISABLE_XET", "0")
    monkeypatch.setenv("VOICEPRINT_ENABLED", "false")
    monkeypatch.setenv("VOICEPRINT_DB_PATH", str(db_path))
    monkeypatch.setenv("VOICEPRINT_MATCH_THRESHOLD", "0.82")
    monkeypatch.setenv("LOCAL_TRANSCRIPTION_PATCH_VLLM_SHUTDOWN", "0")

    qwen_child._apply_runtime_defaults()

    assert qwen_child.os.environ["VLLM_WORKER_MULTIPROC_METHOD"] == "forkserver"
    assert qwen_child.os.environ["HF_HUB_DISABLE_XET"] == "0"
    assert qwen_child.os.environ["VOICEPRINT_ENABLED"] == "false"
    assert qwen_child.os.environ["VOICEPRINT_DB_PATH"] == str(db_path)
    assert qwen_child.os.environ["VOICEPRINT_MATCH_THRESHOLD"] == "0.82"
    assert qwen_child.os.environ["LOCAL_TRANSCRIPTION_PATCH_VLLM_SHUTDOWN"] == "0"


def test_patch_auto_model_disable_update_sets_default_without_overriding_explicit_value():
    calls = []

    class FakeAutoModel:
        def __init__(self, **kwargs):
            calls.append(kwargs)

    assert qwen_child._patch_auto_model_disable_update(FakeAutoModel) is True
    FakeAutoModel(model="a")
    FakeAutoModel(model="b", disable_update=False)

    assert calls == [
        {"model": "a", "disable_update": True},
        {"model": "b", "disable_update": False},
    ]


def test_patch_auto_model_disable_update_is_idempotent():
    calls = []

    class FakeAutoModel:
        def __init__(self, **kwargs):
            calls.append(kwargs)

    assert qwen_child._patch_auto_model_disable_update(FakeAutoModel) is True
    assert qwen_child._patch_auto_model_disable_update(FakeAutoModel) is False
    FakeAutoModel(model="a")

    assert calls == [{"model": "a", "disable_update": True}]


def test_patch_vllm_engine_shutdown_cleanup_wraps_shutdown_once():
    calls = []

    class FakeEngineCore:
        def shutdown(self):
            calls.append("shutdown")

    assert qwen_child._patch_vllm_engine_shutdown_cleanup(FakeEngineCore, lambda: calls.append("cleanup")) is True
    assert qwen_child._patch_vllm_engine_shutdown_cleanup(FakeEngineCore, lambda: calls.append("cleanup2")) is False

    FakeEngineCore().shutdown()

    assert calls == ["shutdown", "cleanup"]


def test_shutdown_runtime_vllm_engines_calls_nested_llm_engines():
    calls = []

    class FakeLLMEngine:
        def shutdown(self):
            calls.append("llm_engine.shutdown")

    class FakeLLM:
        llm_engine = FakeLLMEngine()

    class FakeBackend:
        _llm = FakeLLM()
        _forced_aligner = None

    class FakeQwenEngine:
        model = FakeBackend()

    class FakeRouter:
        _shared_engines = {("qwen_vllm", "qwen3-asr-0.6b"): FakeQwenEngine()}

    qwen_child._shutdown_runtime_vllm_engines(FakeRouter())

    assert calls == ["llm_engine.shutdown"]


def test_patch_vllm_core_client_treats_zero_exitcode_as_expected_shutdown():
    calls = []

    class FakeLogger:
        def info(self, *args):
            calls.append(("info", args))

        def error(self, *args):
            calls.append(("error", args))

    class FakeThread:
        def __init__(self, target, **kwargs):
            self.target = target

        def start(self):
            self.target()

    class FakeProc:
        sentinel = "sentinel"
        name = "EngineCore"
        exitcode = 0

        def join(self, timeout=None):
            calls.append(("join", timeout))

    class FakeFinalizer:
        alive = True

    class FakeResources:
        engine_dead = False
        engine_manager = types.SimpleNamespace(processes=[FakeProc()])

    class FakeMPClient:
        def __init__(self):
            self.resources = FakeResources()
            self._finalizer = FakeFinalizer()

        def shutdown(self):
            calls.append(("shutdown",))

    fake_module = types.SimpleNamespace(
        Thread=FakeThread,
        logger=FakeLogger(),
        weakref=weakref,
        multiprocessing=types.SimpleNamespace(
            connection=types.SimpleNamespace(wait=lambda sentinels: ["sentinel"])
        ),
    )

    assert qwen_child._patch_vllm_core_client_expected_exit(FakeMPClient, fake_module) is True
    FakeMPClient().start_engine_core_monitor()

    assert ("join", 0) in calls
    assert ("shutdown",) in calls
    assert not any(call[0] == "error" for call in calls)


def test_patch_vllm_core_client_uses_injected_wait_when_module_lacks_multiprocessing():
    calls = []

    class FakeLogger:
        def info(self, *args):
            calls.append(("info", args))

        def error(self, *args):
            calls.append(("error", args))

    class FakeThread:
        def __init__(self, target, **kwargs):
            self.target = target

        def start(self):
            self.target()

    class FakeProc:
        sentinel = "sentinel"
        name = "EngineCore"
        exitcode = 0

        def join(self, timeout=None):
            calls.append(("join", timeout))

    class FakeFinalizer:
        alive = True

    class FakeResources:
        engine_dead = False
        engine_manager = types.SimpleNamespace(processes=[FakeProc()])

    class FakeMPClient:
        def __init__(self):
            self.resources = FakeResources()
            self._finalizer = FakeFinalizer()

        def shutdown(self):
            calls.append(("shutdown",))

    fake_module = types.SimpleNamespace(
        Thread=FakeThread,
        logger=FakeLogger(),
        weakref=weakref,
    )

    assert (
        qwen_child._patch_vllm_core_client_expected_exit(
            FakeMPClient,
            fake_module,
            connection_wait=lambda sentinels: ["sentinel"],
        )
        is True
    )
    FakeMPClient().start_engine_core_monitor()

    assert ("join", 0) in calls
    assert ("shutdown",) in calls
    assert not any(call[0] == "error" for call in calls)


def test_expected_vllm_engine_exit_accepts_managed_shutdown_signals():
    class FakeProcess:
        def __init__(self, exitcode):
            self.exitcode = exitcode

    assert qwen_child._expected_vllm_engine_exit(FakeProcess(0)) is True
    assert qwen_child._expected_vllm_engine_exit(FakeProcess(-qwen_child.signal.SIGINT)) is True
    assert qwen_child._expected_vllm_engine_exit(FakeProcess(-qwen_child.signal.SIGTERM)) is True
    assert qwen_child._expected_vllm_engine_exit(FakeProcess(1)) is False


def test_expected_vllm_engine_exit_accepts_any_exit_after_managed_shutdown():
    class FakeProcess:
        exitcode = 1

    previous = qwen_child._MANAGED_SHUTDOWN_REQUESTED
    try:
        qwen_child._MANAGED_SHUTDOWN_REQUESTED = True
        assert qwen_child._expected_vllm_engine_exit(FakeProcess()) is True
    finally:
        qwen_child._MANAGED_SHUTDOWN_REQUESTED = previous
