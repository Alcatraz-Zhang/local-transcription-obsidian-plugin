from pathlib import Path


def test_gateway_image_is_built_from_pinned_upstream_source() -> None:
    dockerfile = Path(__file__).resolve().parents[1] / "Dockerfile"
    text = dockerfile.read_text(encoding="utf-8")
    first_from = next(line for line in text.splitlines() if line.startswith("FROM "))

    assert "quantatrisk/qwen3-asr" not in text.lower()
    assert "QWEN3_ASR_ARCHIVE_URL=https://codeload.github.com/Quantatirsk/qwen3-asr/tar.gz/" in text
    assert (
        "QWEN3_ASR_COMMIT=8723468eaafa98bc571c52a15ec6e3770a0d517e"
        in text
    )
    assert (
        "QWEN3_ASR_ARCHIVE_SHA256=54c33e154b7046724533f0f5bec6c6dde7c972eb48d243e2296b0419f5d26745"
        in text
    )
    assert "nvidia/cuda:13.0.2-cudnn-devel-ubuntu24.04" in first_from
    assert (
        "sha256:ae7f650405a3964972dacfa889273bf8e3fbe9709899afd187da01c4cdff3105"
        in first_from
    )
    assert "ARG UBUNTU_APT_MIRROR=https://mirrors.tuna.tsinghua.edu.cn/ubuntu/" in text
    assert "ARG PYTORCH_CUDA_INDEX=https://download.pytorch.org/whl/cu130" in text
    assert "ARG TORCH_VERSION=2.11.0" in text
    assert "ARG TORCHAUDIO_VERSION=2.11.0" in text
    assert "ARG TORCHVISION_VERSION=0.26.0" in text
    assert "ARG VLLM_PACKAGE=vllm[audio]==0.22.1" in text
    assert "ARG UV_VERSION=0.11.21" in text
    assert "ARG IMAGE_VERSION=0.2.1" in text
    assert 'org.opencontainers.image.source="https://github.com/Alcatraz-Zhang/local-transcription-obsidian-plugin"' in text
    assert "UV_HTTP_TIMEOUT=300" in text
    assert "UV_LINK_MODE=copy" in text
    assert "PIP_DEFAULT_TIMEOUT=300" in text
    assert "PIP_ROOT_USER_ACTION=ignore" in text
    assert "Acquire::Retries=5" in text
    assert "rm -f /etc/apt/sources.list.d/cuda*.list" in text
    assert "python3-dev" in text
    assert "python3-pip" in text
    assert "python3-venv" in text
    assert 'python3 -m pip install --no-cache-dir --timeout 300 --retries 5 "uv==${UV_VERSION}"' in text
    assert "cuda-keyring_1.1-1_all.deb" not in text
    assert "3bf863cc.pub" not in text
    assert "gpg --dearmor" not in text
    assert "cuda-nvcc-13-0" not in text
    assert "git clone" not in text
    assert "ADD --checksum=sha256:${QWEN3_ASR_ARCHIVE_SHA256}" in text
    assert "--mount=type=cache,target=/root/.cache/uv" in text
    assert "--no-install-package torch" in text
    assert "--no-install-package torchaudio" in text
    assert "--no-install-package torchvision" in text
    assert "--no-install-package vllm" in text
    assert "COPY python-constraints-cu130.txt /tmp/python-constraints-cu130.txt" in text
    assert "--constraint /tmp/python-constraints-cu130.txt" in text
