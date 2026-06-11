from pathlib import Path
import json

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
