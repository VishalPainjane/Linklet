# Linklet — Systems-Engineered URL Shortener & Concurrency Lab

A production-grade, systems-engineered URL shortening service designed as a laboratory for concurrency, database locks, cache stampede prevention, asynchronous event pipelines, and load measurement.

Built according to the [`url_shortener_engineering_blueprint.md`](./url_shortener_engineering_blueprint.md).

---

## 1. System Engineering Principles

- **No ORM abstraction layers:** Direct, parameterized SQL queries exposing query plans, indexes, transactions, and explicit locks.
- **Strict typing & zero runtime leakage:** Strict TypeScript with `exactOptionalPropertyTypes`, custom typed `DomainError` hierarchy, and zero credential or stack-trace leaks in HTTP responses.
- **Modulo-bias-free random code generator:** Cryptographic rejection sampling over Base62 (`62^8` keyspace = 218 trillion codes), rejecting biased bytes `[248..255]`.
- **Database-enforced concurrency:** Primary key B-tree on `code` enforces uniqueness under concurrent creation and custom alias claims without brittle distributed locks.
- **Cache stampede elimination:** In-flight query collapsing (`SingleFlight`) prevents multiple concurrent misses for the same key from dogpiling PostgreSQL.
- **At-least-once delivery with idempotent processing:** Consumer transactions deduplicate incoming click events via `processed_events` primary key before incrementing `url_stats`.

---

## 2. Architecture & Monorepo Layout

```text
Linklet/
├── apps/
│   ├── api-node/                  # Express 5 on Node.js 22 LTS
│   ├── api-worker/                # Cloudflare Workers adapter (Phase 8)
│   └── queue-consumer-worker/     # Cloudflare Queues consumer (Phase 8)
│
├── packages/
│   ├── shared-types/              # Domain models, errors, and contracts
│   ├── code-generator/            # Base62 crypto generator with rejection sampling
│   ├── validation/                # Zod schemas (URL security, alias rules, events)
│   ├── cache/                     # CacheRepository, custom O(1) LRU & SingleFlight
│   ├── events/                    # ClickEvent contracts and coarse metadata extractors
│   ├── rate-limiter/              # Sliding window & atomic Redis Lua script
│   ├── database/                  # Schema, migrations runner, and repository contracts
│   └── core/                      # UrlService (creation, resolution, invalidation)
│
├── adapters/
│   ├── postgres-node/             # pg.Pool connection adapter & SQL transactions
│   ├── redis-node/                # node-redis client with timeouts & reconnect backoff
│   └── rabbitmq/                  # amqplib publisher confirm channel & consumer
│
├── migrations/
│   └── 001_initial_schema.sql     # PostgreSQL schema, check constraints & indexes
│
├── testing/
│   └── concurrency/               # 1,000+ virtual user race condition harness
│
├── docker-compose.yml             # PostgreSQL 17, Redis 7, RabbitMQ 4
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── package.json
```

---

## 3. Getting Started

### Prerequisites

- Node.js >= 22 LTS
- pnpm >= 10
- Docker & Docker Compose (optional for local full-stack lab; in-memory fallback included for headless testing)

### Installation & Build

```bash
# Install dependencies across all workspace packages
pnpm install

# Typecheck all packages
pnpm typecheck

# Build all packages
pnpm build
```

### Running Tests

```bash
# Run all tests (unit, property-based, integration, and concurrency)
pnpm test
```

### Starting the Local Development Lab

```bash
# 1. Start local PostgreSQL, Redis, and RabbitMQ
docker compose up -d

# 2. Start the Express 5 API server
pnpm dev:api
```

---

## 4. API Endpoints

| Method | Endpoint | Description | Status Codes |
|---|---|---|---|
| `POST` | `/api/v1/urls` | Create short link (generated or custom alias, optional `Idempotency-Key`) | `201`, `400`, `409`, `422`, `429` |
| `GET` | `/:code` | Redirect to destination URL (`Cache-Control: no-store`) | `302`, `404`, `410` |
| `HEAD` | `/:code` | Retrieve redirect headers without response body | `302`, `404`, `410` |
| `GET` | `/api/v1/urls/:code` | Retrieve link metadata without tracking click | `200`, `404` |
| `DELETE` | `/api/v1/urls/:code` | Disable short link and invalidate cache | `200`, `404` |
| `GET` | `/api/v1/urls/:code/stats`| Retrieve click analytics | `200`, `404` |
| `GET` | `/health` | Liveness probe | `200` |
| `GET` | `/ready` | Readiness probe (database/cache connectivity check) | `200`, `503` |

---

## 5. Concurrency Test Invariants

The test suite in [`testing/concurrency/concurrency.test.ts`](./testing/concurrency/concurrency.test.ts) verifies:

1. **Custom Alias Races:** 1,000 simultaneous requests claiming the same custom alias results in exactly 1 success (`201`) and 999 conflicts (`409`).
2. **Duplicate Destination Creation:** 500 simultaneous requests for the same destination URL create 500 independent, globally unique short codes.
3. **Idempotency Races:** 500 simultaneous client retries with the same `Idempotency-Key` create exactly 1 logical URL; all 500 receive the exact same response.
4. **Cache Stampede Protection:** 1,000 simultaneous cache misses on a cold code result in exactly 1 PostgreSQL lookup via `SingleFlight`.

