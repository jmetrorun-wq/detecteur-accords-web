FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential gcc g++ ffmpeg libsndfile1 curl ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

COPY . .

RUN pip install --no-cache-dir -r requirements.txt

RUN curl -sL -o bgutil-pot \
    https://github.com/jim60105/bgutil-ytdlp-pot-provider-rs/releases/download/v0.8.1/bgutil-pot-linux-x86_64 \
    && chmod +x bgutil-pot

ENV NUMBA_DISABLE_JIT=1
ENV PYTHONPATH=/app

EXPOSE 8080

CMD ["bash", "-c", "./bgutil-pot server --host 127.0.0.1 --port 4416 & exec gunicorn app:app --bind 0.0.0.0:${PORT:-8080} --workers 1 --timeout 180"]
