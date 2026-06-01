FROM quantatrisk/qwen3-asr:gpu-latest AS gateway

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    GATEWAY_PORT=17002 \
    IDLE_TIMEOUT=300

WORKDIR /app
COPY gateway_app /gateway/gateway_app
WORKDIR /app

ENV PYTHONPATH=/gateway:/app \
    HOST=127.0.0.1 \
    PORT=18000 \
    HF_HOME=/root/.cache/huggingface \
    MODELSCOPE_PATH=/root/.cache/modelscope/hub/models \
    MODELSCOPE_CACHE=/root/.cache/modelscope \
    HF_HUB_DISABLE_XET=1

EXPOSE 17002
CMD ["/opt/venv/bin/python", "-m", "gateway_app"]
