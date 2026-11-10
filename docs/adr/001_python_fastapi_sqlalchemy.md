# ADR 001: Architecture Migration to Python 3.12, FastAPI, SQLAlchemy 2.x Async ORM, Redis, and Locust

**Status:** Accepted  
**Date:** 2026-11-10  
**Context:**  
The Linklet platform was initially conceived as an Express/TypeScript proof-of-concept. As the project scope evolved into a comprehensive systems-engineering laboratory, the engineering team required:
1. Deep inspection of SQL query execution, transaction isolation, connection pools, and MVCC semantics.
2. Production-grade asynchronous Python tooling managed reproducibly via `uv`.
3. Standardized distributed load-testing scenarios via `locust` to model virtual users, closed-loop arrival rates, and tail latency percentiles without proprietary load engines.
4. Traditional message brokering topology via RabbitMQ with manual acknowledgements, publisher confirms, prefetch bounds, and idempotent consumer ledgers.

**Decision:**
1. **Runtime & Framework:** Python 3.12+ managed by `uv`, utilizing `FastAPI` + `Uvicorn` for high-throughput ASGI request processing.
2. **Persistence:** PostgreSQL 17 accessed via `SQLAlchemy 2.x` async ORM (`create_async_engine`, `async_sessionmaker`, `AsyncSession` per request) and `asyncpg`.
3. **Database Migrations:** `Alembic` with version-controlled migrations (`alembic/versions/`).
4. **Caching & Rate Limiting:** `Redis` via `redis.asyncio` with single-flight stampede protection and atomic Lua counter rate limiters, supplemented by an in-process $O(1)$ LRU doubly-linked list experiment.
5. **Asynchronous Messaging:** `RabbitMQ` via `aio-pika` utilizing topic exchanges (`analytics.events`), durable queues (`url.clicks.v1`), DLQ topology, publisher confirms, and idempotent database aggregation.
6. **Load Testing:** `Locust` modeling mixed (99% redirect / 1% create), hot-key, and write-heavy workloads.
7. **Frontend:** `Next.js 15` App Router with Tailwind CSS in `frontend/`.

**Consequences:**
- Full type safety verified statically via `mypy --strict` and formatted with `ruff`.
- 100% test coverage spanning unit, property-based (`hypothesis`), async integration (`httpx`), and concurrent race tests.
- Clean isolation between API process, message broker, and consumer daemons.
