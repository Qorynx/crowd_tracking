FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# OpenCV/Ultralytics need the small runtime system libraries below.  The
# frontend is deliberately not copied into this image; it is deployed as a
# separate Vite application.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY deploy/requirements-api-runtime.txt /tmp/requirements-api-runtime.txt
RUN pip install --no-cache-dir -r /tmp/requirements-api-runtime.txt

COPY src ./src
COPY configs ./configs
COPY models ./models
COPY artifacts ./artifacts

EXPOSE 8000

CMD ["uvicorn", "src.api.app:create_api_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
