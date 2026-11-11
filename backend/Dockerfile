FROM python:3.12-slim

# System dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code and Alembic migrations
COPY . .

# Install linklet package
RUN pip install --no-cache-dir -e .

EXPOSE 8000

ENV PORT=8000 \
    PYTHONUNBUFFERED=1

CMD ["sh", "-c", "alembic upgrade head && uvicorn linklet.main:app --host 0.0.0.0 --port ${PORT:-8000}"]

