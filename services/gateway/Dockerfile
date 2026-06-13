FROM nvidia/cuda:13.0.2-cudnn-devel-ubuntu24.04@sha256:ae7f650405a3964972dacfa889273bf8e3fbe9709899afd187da01c4cdff3105 AS gateway

ARG QWEN3_ASR_COMMIT=8723468eaafa98bc571c52a15ec6e3770a0d517e
ARG QWEN3_ASR_ARCHIVE_URL=https://codeload.github.com/Quantatirsk/qwen3-asr/tar.gz/
ARG QWEN3_ASR_ARCHIVE_SHA256=54c33e154b7046724533f0f5bec6c6dde7c972eb48d243e2296b0419f5d26745
ARG UBUNTU_APT_MIRROR=https://mirrors.tuna.tsinghua.edu.cn/ubuntu/
ARG PYTORCH_CUDA_INDEX=https://download.pytorch.org/whl/cu130
ARG TORCH_VERSION=2.11.0
ARG TORCHAUDIO_VERSION=2.11.0
ARG TORCHVISION_VERSION=0.26.0
ARG VLLM_PACKAGE=vllm[audio]==0.22.1
ARG UV_VERSION=0.11.21
ARG TORCH_CUDA_ARCH_LIST=12.0+PTX
ARG IMAGE_VERSION=0.2.2

LABEL org.opencontainers.image.title="Local Transcription ASR Gateway" \
    org.opencontainers.image.description="Dockerized Qwen3-ASR gateway for the Local Transcription Obsidian plugin" \
    org.opencontainers.image.version="${IMAGE_VERSION}" \
    org.opencontainers.image.source="https://github.com/Alcatraz-Zhang/local-transcription-obsidian-plugin" \
    org.opencontainers.image.documentation="https://github.com/Alcatraz-Zhang/local-transcription-obsidian-plugin#readme"

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HUB_DISABLE_SYMLINKS_WARNING=1 \
    HF_HUB_DISABLE_PROGRESS_BARS=1 \
    PIP_DEFAULT_TIMEOUT=300 \
    PIP_BREAK_SYSTEM_PACKAGES=1 \
    PIP_ROOT_USER_ACTION=ignore \
    UV_HTTP_TIMEOUT=300 \
    UV_LINK_MODE=copy \
    PATH=/opt/venv/bin:$PATH \
    VIRTUAL_ENV=/opt/venv \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    TORCH_CUDA_ARCH_LIST=${TORCH_CUDA_ARCH_LIST} \
    GATEWAY_PORT=17003 \
    IDLE_TIMEOUT=300 \
    MIN_DIARIZATION_DURATION_SECONDS=5.0 \
    VOICEPRINT_ENABLED=true \
    VOICEPRINT_DB_PATH=/data/voiceprints.sqlite3 \
    VOICEPRINT_MATCH_THRESHOLD=0.70 \
    VLLM_WORKER_MULTIPROC_METHOD=spawn

RUN rm -f /etc/apt/sources.list.d/cuda*.list \
    && sed -i "s|http://archive.ubuntu.com/ubuntu/|${UBUNTU_APT_MIRROR}|g; s|http://security.ubuntu.com/ubuntu/|${UBUNTU_APT_MIRROR}|g" /etc/apt/sources.list.d/ubuntu.sources \
    && apt-get -o Acquire::Retries=5 update \
    && apt-get -o Acquire::Retries=5 install -y --no-install-recommends \
        ca-certificates \
        wget \
        python3 \
        python3-dev \
        python3-pip \
        python3-venv \
        ffmpeg \
        sox \
        libsox-dev \
        libsndfile1 \
        nginx \
        build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /tmp
ADD --checksum=sha256:${QWEN3_ASR_ARCHIVE_SHA256} ${QWEN3_ASR_ARCHIVE_URL}${QWEN3_ASR_COMMIT} /tmp/qwen3-asr.tar.gz
RUN mkdir -p /tmp/qwen3-asr \
    && tar -xzf /tmp/qwen3-asr.tar.gz -C /tmp/qwen3-asr --strip-components=1 \
    && test -f /tmp/qwen3-asr/pyproject.toml \
    && test -f /tmp/qwen3-asr/uv.lock

WORKDIR /app
COPY python-constraints-cu130.txt /tmp/python-constraints-cu130.txt
RUN cp /tmp/qwen3-asr/pyproject.toml /tmp/qwen3-asr/uv.lock /app/

RUN python3 -m pip install --no-cache-dir --timeout 300 --retries 5 "uv==${UV_VERSION}"
RUN --mount=type=cache,target=/root/.cache/uv \
    uv venv /opt/venv \
    && uv sync --no-dev --no-install-project --frozen \
        --no-install-package torch \
        --no-install-package torchaudio \
        --no-install-package torchvision \
        --no-install-package vllm
RUN --mount=type=cache,target=/root/.cache/uv \
    uv pip install --reinstall --constraint /tmp/python-constraints-cu130.txt --index-url "${PYTORCH_CUDA_INDEX}" --extra-index-url https://pypi.org/simple \
        "torch==${TORCH_VERSION}" \
        "torchaudio==${TORCHAUDIO_VERSION}" \
        "torchvision==${TORCHVISION_VERSION}"
RUN --mount=type=cache,target=/root/.cache/uv \
    uv pip install --reinstall --constraint /tmp/python-constraints-cu130.txt "${VLLM_PACKAGE}"

RUN /opt/venv/bin/python - <<'PY'
import torch
import torchaudio
import transformers
import vllm
from transformers import PreTrainedModel

print("torch", torch.__version__)
print("torchaudio", torchaudio.__version__)
print("transformers", transformers.__version__)
print("vllm", vllm.__version__)
print("transformers PreTrainedModel", PreTrainedModel.__name__)
PY

RUN cp -a /tmp/qwen3-asr/. /app/ \
    && rm -rf /app/.git /tmp/qwen3-asr \
    && mkdir -p /app/temp /app/data /app/logs \
    && chmod +x start.py /app/scripts/docker/entrypoint.sh

COPY sitecustomize.py /gateway/sitecustomize.py
COPY gateway_app /gateway/gateway_app

ENV PYTHONPATH=/gateway:/app \
    HOST=127.0.0.1 \
    PORT=18000 \
    HF_HOME=/root/.cache/huggingface \
    MODELSCOPE_PATH=/root/.cache/modelscope/models \
    MODELSCOPE_CACHE=/root/.cache/modelscope \
    HF_HUB_DISABLE_XET=1

EXPOSE 17003
ENTRYPOINT ["/app/scripts/docker/entrypoint.sh"]
CMD ["/opt/venv/bin/python", "-m", "gateway_app"]
