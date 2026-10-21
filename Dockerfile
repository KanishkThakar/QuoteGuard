FROM python:3.13-slim
WORKDIR /app
COPY --from=ghcr.io/astral-sh/uv:0.12.9 /uv /usr/local/bin/uv
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY backend ./backend
ENV PATH="/app/.venv/bin:$PATH" PYTHONPATH="/app/backend"
WORKDIR /app/backend
CMD ["gunicorn","config.wsgi:application","--bind","0.0.0.0:8000","--workers","3","--timeout","30"]
