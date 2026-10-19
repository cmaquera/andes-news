FROM python:3.12-slim
ARG LAYA_VERSION=0.4.11
# CPU inference leaves the existing Ollama GPU available for generation.
RUN pip install --no-cache-dir torch==2.14.0 --index-url https://download.pytorch.org/whl/cpu && pip install --no-cache-dir "laya[serve]==${LAYA_VERSION}" && pip check
RUN useradd -m -u 10001 laya && mkdir /models && chown laya:laya /models
ENV LAYA_HOST=0.0.0.0 LAYA_PORT=8000 LAYA_DEVICE=cpu LAYA_MODELS=multilingual LAYA_PRELOAD=1 LAYA_MAX_LOADED=1 LAYA_THREADS=2 LAYA_MAX_CONCURRENT=1 HF_HOME=/models TORCH_DISABLE_NATIVE_JIT=1
USER laya
CMD ["laya-serve"]
