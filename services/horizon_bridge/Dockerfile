FROM python:3.12-slim
ARG HORIZON_REVISION=8f5446bf45c2d7763d17423d97d17906add85da1
ARG INSTALL_OPENBB=0
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.9.4 /uv /usr/local/bin/uv
RUN git clone https://github.com/Thysrael/Horizon.git /opt/horizon && cd /opt/horizon && git checkout "$HORIZON_REVISION" && test "$(git rev-parse HEAD)" = "$HORIZON_REVISION"
WORKDIR /opt/horizon
RUN if [ "$INSTALL_OPENBB" = "1" ]; then uv sync --frozen --no-dev --extra openbb; else uv sync --frozen --no-dev; fi
RUN useradd -m -u 10001 bridge && mkdir /data && chown bridge:bridge /data
COPY bridge.py safe_http.py /app/
ENV PYTHONPATH=/opt/horizon PYTHONUNBUFFERED=1
USER bridge
WORKDIR /app
CMD ["/opt/horizon/.venv/bin/python", "bridge.py"]
