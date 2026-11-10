# Linklet — Complete URL Shortener Engineering Blueprint

**Document status:** Updated baseline / source of truth  
**Revision:** 2.0  
**Project name:** Linklet  
**Product:** Production URL shortener and systems-engineering laboratory  

> A tiny link, backed by serious engineering.

---

## 1. Stack and Architecture Overview

Linklet is built as an industrial-strength URL shortener designed to study backend concurrency, caching dynamics, asynchronous message delivery, and tail-latency profiling under heavy load.

| Layer | Technology | Role |
|---|---|---|
| **Backend Runtime** | Python 3.12+ (managed by `uv`) | API routes, business logic, consumer daemons, load tests |
| **HTTP Framework** | FastAPI + Uvicorn | ASGI server, dependency injection, OpenAPI contract |
| **Validation & Settings** | Pydantic v2 + `pydantic-settings` | Schema validation, environment variable parsing |
| **Data Persistence** | PostgreSQL 17 + SQLAlchemy 2.x Async ORM | Authoritative URL persistence, idempotency ledger, analytics |
| **Database Migrations**| Alembic | Version-controlled DDL schema evolutions |
| **Distributed Cache** | Redis 7 + `redis.asyncio` | Shared URL cache, single-flight coalescing, Lua rate limiters |
| **Process-Local Cache**| Custom $O(1)$ LRU Cache | Doubly-linked list + hash map benchmark laboratory |
| **Message Broker** | RabbitMQ 4 + `aio-pika` | Topic exchanges, durable queues, publisher confirms, manual ACK |
| **Performance Testing**| Locust | Virtual user simulation, mixed workload distribution, tail latencies |
| **Frontend UI** | Next.js 15 App Router + Tailwind CSS | Dashboard, link creation, latency probe, analytics inspector |

---

## 2. Request Flows and Invariants

### 2.1 Short URL Creation (`POST /api/v1/urls`)
1. **Schema Validation:** Enforces valid HTTP/HTTPS schemes, maximum length 2048 chars, alias regex (`^[a-zA-Z0-9_-]{2,32}$`), and strictly future expiration dates.
2. **Idempotency Guard:**
   - Client sends optional `Idempotency-Key` header.
   - Computes deterministic SHA-256 hash of payload.
   - Atomically attempts to claim the key in `idempotency_keys` table using `INSERT ... ON CONFLICT DO NOTHING RETURNING`.
   - If key already claimed: polls/waits for winner's committed response; returns 200 with cached body if payload matches, or 409 Conflict if payload differs.
3. **Collision Avoidance:**
   - Generated links use cryptographically secure Base62 random sampling (`secrets.choice`).
   - Inserts into PostgreSQL using `INSERT ... ON CONFLICT (code) DO NOTHING RETURNING code`.
   - Bounded retry budget (5 attempts) guarantees collision recovery without global serialization locks.
4. **Custom Alias Contention:**
   - Enforces unique B-tree constraint.
   - Under simultaneous contention by N contenders, exactly 1 succeeds (201) and N-1 receive 409 Conflict.

### 2.2 Redirect Resolution (`GET /{code}`)
1. **Cache-Aside Lookup:** Checks Redis key `url:{code}`.
2. **Cache Hit:** Validates expiration and disabled status. Returns `302 Found` with `Location` header and `Cache-Control: no-store`.
3. **Cache Miss & Stampede Mitigation:**
   - Employs double-checked locking with process-local single-flight mutex per short code.
   - Falls back to PostgreSQL primary key lookup (`code`).
   - Caches active URLs with TTL capped at `min(default_ttl, remaining_link_lifetime)`.
   - Returns 404 for unknown codes; returns 410 for expired or disabled links.
4. **Async Analytics Dispatch:**
   - Non-blocking enqueue to bounded in-memory buffer (`asyncio.Queue`, Mode A).
   - Dedicated background drain worker publishes persistent message to RabbitMQ with publisher confirms.

### 2.3 Idempotent Analytics Aggregation
1. **Queue Topology:** Topic exchange `analytics.events` bound to durable queue `url.clicks.v1` with routing key `url.click` and Dead Letter Exchange (`analytics.dlx`).
2. **Prefetch & Manual ACK:** Consumer daemon sets `prefetch_count=50` and only acknowledges (ACK) the broker message **after** the PostgreSQL transaction successfully commits.
3. **Deduplication Ledger:** Atomic Common Table Expression (CTE) inserts `event_id` into `processed_events` table; only newly inserted events increment `url_stats.click_count`.

---

## 3. Repository Structure

```text
Linklet/
├── frontend/                      # Next.js 15 App Router UI
│   ├── src/app/
│   ├── src/components/
│   ├── src/lib/api.ts
│   └── package.json
├── backend/                       # Python 3.12 FastAPI backend managed via uv
│   ├── pyproject.toml
│   ├── uv.lock
│   ├── alembic.ini
│   ├── alembic/
│   ├── src/linklet/
│   │   ├── main.py
│   │   ├── config.py
│   │   ├── database.py
│   │   ├── models/
│   │   ├── schemas/
│   │   ├── api/routes/
│   │   ├── services/
│   │   ├── repositories/
│   │   ├── cache/
│   │   ├── messaging/
│   │   └── workers/
│   └── tests/
│       ├── unit/
│       ├── integration/
│       └── concurrency/
├── loadtests/                     # Locust load test suite
│   ├── locustfile.py
│   ├── scenarios/
│   └── README.md
├── infrastructure/                # Local Docker Compose topology
│   └── docker-compose.yml
└── docs/                          # Architecture Decision Records & Blueprint
    ├── ENGINEERING_BLUEPRINT.md
    └── adr/
```

