# Linklet Backend Service

Distributed, high-concurrency URL shortening and systems-engineering engine built with **FastAPI**, **Redis 7**, **PostgreSQL (Neon / asyncpg)**, and **RabbitMQ 4 (aio-pika)**.

---

## Architecture Overview

- **FastAPI ASGI Application**: Async request handling, Pydantic v2 validation, and OpenAPI documentation.
- **Redis Cache-Aside & SingleFlight**: Distributed caching with in-flight request coalescing to eliminate cache stampedes (*dogpiling*).
- **PostgreSQL Persistence**: ACID guarantees with connection pooling, statement caching optimizations, and normalized SSL connection parameters for Neon Serverless.
- **RabbitMQ Click Telemetry**: Lossless, decoupled click tracking using topic exchanges and an asynchronous worker consumer.
- **Transactional Outbox**: Guaranteed cache invalidation on link mutation/deletion with zero race conditions.

---

## Directory Structure

```text
backend/
├── alembic/                # Database migration scripts (Async SQLAlchemy)
│   ├── versions/
│   └── env.py
├── src/
│   └── linklet/
│       ├── api/            # Route controllers (links, auth, latency, analytics)
│       ├── cache.py        # Redis cache-aside & SingleFlight primitives
│       ├── config.py       # Pydantic Settings & environment config
│       ├── database.py     # asyncpg session manager & connection pool
│       ├── main.py         # FastAPI application entrypoint & middleware
│       ├── models.py       # SQLAlchemy ORM declarations
│       ├── schemas.py      # Pydantic schemas & response models
│       └── services.py     # Business logic & short URL generators
├── tests/                  # Pytest async unit & property-based tests
├── pyproject.toml          # uv / PEP 621 package metadata
└── requirements.txt        # Frozen dependency tree
```

---

## Local Development

### 1. Environment Configuration

Create a `.env` file in `backend/` or set the following environment variables:

```bash
DATABASE_URL="postgresql+asyncpg://<user>:<password>@<host>/<database>?ssl=require"
REDIS_URL="redis://localhost:6379/0"
RABBITMQ_URL="amqp://guest:guest@localhost:5672/"
PUBLIC_SHORT_BASE_URL="https://linklet-six.vercel.app"
ALLOWED_CORS_ORIGINS='["http://localhost:3000","https://linklet-six.vercel.app"]'
```

### 2. Install Dependencies

Using `uv` (recommended):
```bash
uv sync --all-groups
```

Or using standard `pip`:
```bash
pip install -r requirements.txt
pip install -e .
```

### 3. Run Migrations

```bash
uv run alembic upgrade head
```

### 4. Start the Application

```bash
uv run uvicorn linklet.main:app --host 0.0.0.0 --port 8000 --reload
```

Interactive OpenAPI documentation is live at `http://localhost:8000/docs`.

---

## Testing & Quality Assurance

Linklet enforces strict type checking and automated test verification:

```bash
# Run unit & property tests
uv run pytest -v

# Run type checker
uv run mypy src tests

# Run linter & formatter
uv run ruff check .
```

