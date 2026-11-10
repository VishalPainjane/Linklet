# Linklet

> High-performance URL shortener and systems-engineering laboratory.

Linklet is an industrial-strength URL shortener built to study backend concurrency, caching dynamics, asynchronous message delivery, and tail-latency profiling under heavy load.

---

## Architecture & Technology Stack

- **Backend Runtime:** Python 3.12+ managed by [`uv`](https://astral.sh/uv)
- **API Framework:** [FastAPI](https://fastapi.tiangolo.com/) with asynchronous ASGI routing via Uvicorn
- **ORM & Data Persistence:** [SQLAlchemy 2.x](https://www.sqlalchemy.org/) async ORM with `asyncpg` and PostgreSQL 17
- **Database Migrations:** [Alembic](https://alembic.sqlalchemy.org/)
- **Distributed Cache & Rate Limiting:** Redis 7 (`redis.asyncio`) with SingleFlight coalescing and atomic Lua rate limiters
- **In-Memory Cache Experiment:** Process-local $O(1)$ LRU Cache implemented from scratch with a Doubly-Linked List and Hash Map
- **Asynchronous Messaging:** RabbitMQ 4 (`aio-pika`) with topic exchanges, publisher confirms, prefetch bounds, DLQ topology, and idempotent consumer deduplication
- **Performance & Load Testing:** [Locust](https://locust.io/) modeling mixed read/write workloads and tail-latency percentiles
- **Frontend Dashboard:** [Next.js 15](https://nextjs.org/) App Router, React 19, and Tailwind CSS

---

## Quickstart

### Prerequisites
- Python 3.12+
- `uv` (`pip install uv` or `winget install astral-sh.uv`)
- Node.js 20+ and `pnpm` (for the Next.js frontend)
- Docker & Docker Compose (for PostgreSQL, Redis, and RabbitMQ)

### 1. Start Infrastructure
```bash
docker compose -f infrastructure/docker-compose.yml up -d
```
Starts:
- PostgreSQL 17 (`localhost:5432`)
- Redis 7 (`localhost:6379`)
- RabbitMQ 4 with Management UI (`localhost:5672`, UI at `localhost:15672`)

### 2. Run Backend
```bash
cd backend
python -m uv sync --all-groups
python -m uv run alembic upgrade head
python -m uv run uvicorn linklet.main:app --reload --host 127.0.0.1 --port 8000
```
API Documentation is available at [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs).

### 3. Run Test Suite
```bash
cd backend
python -m uv run pytest -v
python -m uv run ruff check .
python -m uv run mypy src
```

### 4. Run Load Tests with Locust
```bash
cd backend
python -m uv run locust -f ../loadtests/locustfile.py --host http://localhost:8000
```
Interactive UI accessible at [http://localhost:8089](http://localhost:8089).

### 5. Run Frontend
```bash
cd frontend
pnpm install
pnpm dev
```
Accessible at [http://localhost:3000](http://localhost:3000).

---

## Concurrency and Correctness Invariants

- **Zero Collisions on Generated Codes:** Bounded retry loop (`INSERT ... ON CONFLICT (code) DO NOTHING RETURNING code`) with Base62 cryptographic random sampling.
- **Custom Alias Race Guarantee:** Under 50 simultaneous contenders claiming the same alias, exactly 1 wins (HTTP 201) and 49 receive HTTP 409 Conflict.
- **Atomic Idempotency:** Concurrent requests submitting identical payloads with the same `Idempotency-Key` are resolved to the winner's canonical response without duplicate URL creation.
- **Cache Stampede Prevention:** SingleFlight mutex per key coalesces concurrent cache misses during cold-cache bursts.
- **Idempotent Queue Consumer:** Deduplication ledger (`processed_events`) guarantees at-least-once message delivery without double-counting click statistics.
