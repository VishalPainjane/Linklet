# Linklet

<div align="center">

**High-Performance Distributed URL Shortener & Systems-Engineering Laboratory**

[![CI Pipeline](https://github.com/VishalPainjane/Linklet/actions/workflows/ci.yml/badge.svg)](https://github.com/VishalPainjane/Linklet/actions/workflows/ci.yml)
[![Live Frontend](https://img.shields.io/badge/Frontend-Vercel-black?logo=vercel)](https://linklet-six.vercel.app)
[![API Docs](https://img.shields.io/badge/API%20Docs-Render-46E3B7?logo=render)](https://linklet-api-ikru.onrender.com/docs)
[![Database](https://img.shields.io/badge/Database-Neon%20Postgres-00E599?logo=postgresql)](https://neon.tech)
[![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python)](https://python.org)
[![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](https://nextjs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[**Explore Live App**](https://linklet-six.vercel.app) • [**API Documentation**](https://linklet-api-ikru.onrender.com/docs) • [**Architecture Blueprint**](docs/ENGINEERING_BLUEPRINT.md) • [**GitHub Repository**](https://github.com/VishalPainjane/Linklet)

</div>

---

## 1. Project Overview

Linklet is an industrial-strength, distributed URL shortener engineered to explore and solve real-world systems challenges: **high-concurrency race conditions**, **cache stampedes (dogpiling)**, **asynchronous click telemetry**, **transactional cache invalidation**, and **tail-latency profiling** under saturated load.

Unlike trivial URL shorteners that lock a relational database synchronously on every redirect, Linklet achieves **sub-17ms server-side p50 redirects at 2,000+ req/s** by coupling **Redis 7** cache-aside with SingleFlight stampede collapse, streaming click events to **RabbitMQ 4**, and applying an **ACID Transactional Outbox pattern** to guarantee zero cache drift.

### Live Production Deployments

- **Web Application (Vercel):** [https://linklet-six.vercel.app](https://linklet-six.vercel.app)
- **API Documentation & Swagger (Render):** [https://linklet-api-ikru.onrender.com/docs](https://linklet-api-ikru.onrender.com/docs)
- **Database (Neon Serverless):** PostgreSQL 18 with connection pooling, autoscaling, and libpq SSL normalization.
- **GitHub Repository:** [https://github.com/VishalPainjane/Linklet](https://github.com/VishalPainjane/Linklet)

---

## 2. Core Systems Engineering Invariants

```
                                  ┌────────────────────────┐
                                  │   Next.js 15 App       │
                                  │   (Vercel Edge)        │
                                  └───────────┬────────────┘
                                              │ HTTP / JSON
                                              ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                FastAPI ASGI Cluster                                    │
│                                                                                        │
│  ┌───────────────────────┐  SingleFlight  ┌─────────────────────────────────────────┐  │
│  │   GET /{code}         ├───────────────►│ Redis 7 Distributed Cache               │  │
│  │   Sub-17ms Redirect   │                │ • url:{code} (15m TTL)                  │  │
│  └───────────┬───────────┘                │ • tombstone:{code} (410 Gone, 1h TTL)   │  │
│              │                            │ • session:{token} (7d TTL)              │  │
│              │ Async                      └─────────────────────────────────────────┘  │
│              │ In-Memory Buffer                                                        │
│              ▼                                                                         │
│  ┌───────────────────────┐   Batch drain  ┌─────────────────────────────────────────┐  │
│  │ Bounded Async         ├───────────────►│ RabbitMQ 4 Event Stream                 │  │
│  │ Click Publisher       │                │ • Exchange: analytics.events (topic)    │  │
│  └───────────────────────┘                │ • Queue: url.clicks.v1 (durable)        │  │
│                                           │ • DLX: analytics.dlx                    │  │
│                                           └───────────────────┬─────────────────────┘  │
│                                                               │ Prefetch 50            │
│                                                               ▼ Manual ACK             │
│  ┌───────────────────────┐                ┌─────────────────────────────────────────┐  │
│  │ Transactional Outbox  │                │ Background Click Consumer               │  │
│  │ Relay Worker          │                │ • Deduplicates via processed_events CTE │  │
│  └───────────┬───────────┘                │ • Increments url_stats atomically       │  │
│              │                            └───────────────────┬─────────────────────┘  │
└──────────────┼────────────────────────────────────────────────┼────────────────────────┘
               │                                                │
               ▼                                                ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              PostgreSQL 17 / Neon DB                                   │
│  • users (UUID, email, password_hash, created_at)                                      │
│  • urls (code, destination_url, is_custom, expires_at, disabled_at)                    │
│  • idempotency_keys (key, payload_hash, response_code, response_body)                  │
│  • outbox_events (id, event_type, payload, status, created_at)                          │
│  • url_stats (code, click_count, last_clicked_at)                                      │
│  • processed_events (event_id, processed_at)                                           │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

1. **Zero Modulo-Bias Base62 Encoding:**
   Cryptographic random code generation using `secrets.choice` across alphabet `[a-zA-Z0-9]` with bounded collision retry loops (`INSERT ... ON CONFLICT (code) DO NOTHING RETURNING code`).
2. **Custom Alias Race Guarantee:**
   Under simultaneous contention by $N$ concurrent contenders claiming the exact same alias, database unique constraints guarantee that **exactly 1 contender succeeds** (HTTP 201 Created) and $N-1$ contenders receive HTTP 409 Conflict without race conditions or deadlocks.
3. **Atomic Distributed Idempotency:**
   Clients provide an `Idempotency-Key` header with payload hashing (SHA-256). In-flight requests lock the key atomically; duplicates receive the canonical cached response body without duplicate URL generation.
4. **SingleFlight Cache Coalescing (Stampede Protection):**
   When a popular URL expires or experiences a cold cache miss under heavy traffic, in-process mutexes collapse concurrent requests into **a single database query**, completely shielding PostgreSQL from connection pool exhaustion.
5. **Transactional Outbox & Cache Tombstones:**
   When a link is disabled or deleted, the change is committed together with an `outbox_events` record in the **same ACID transaction**. A background outbox worker synchronizes tombstone entries (`tombstone:{code}`) into Redis with HTTP 410 Gone status.
6. **Lossless Asynchronous Click Telemetry:**
   Redirect execution never waits for database writes. Clicks are enqueued in microseconds to a bounded buffer, dispatched via RabbitMQ 4 with publisher confirms, and batched into PostgreSQL using an idempotent Common Table Expression (CTE) deduplication ledger.

---

## 3. Authentication & Security Architecture

Linklet features a complete, multi-provider authentication and session management system:

- **Bcrypt Password Security:** Real salted password hashing using 12 rounds of `bcrypt` with constant-time cryptographic verification (`verify_password`).
- **Dedicated Dual Modes:** Distinct `/register` (HTTP 201 Created) and `/login` (HTTP 200 OK) endpoints with frontend email and password validation.
- **Google OAuth 2.0 Integration:** Integrated Google Identity Services (GIS) One-Tap and 1-Click sign-in button. Google ID tokens are verified against Google's public key certs (`google.auth.transport.requests`) and automatically linked to PostgreSQL user accounts.
- **Persistent Session Bearer Tokens:** 192-bit cryptographically secure session tokens (`lkt_sess_<hex>`) stored in Redis with 7-day TTL and delivered via `Authorization: Bearer` and `HttpOnly`, `SameSite=Lax` cookies.

---

## 4. Frontend Experience (Next.js 15)

The frontend is a modern, responsive web application built with Next.js 15 App Router, React 19, and Tailwind CSS:

- **Dynamic App Router Redirects (`/[code]`):** When visitors access a short link (e.g. `https://linklet-six.vercel.app/4VKeA6us`), Next.js resolves the destination in real time and executes an instant HTTP redirect.
- **Origin-Aware Short URLs:** Short links dynamically format to the active host origin (`https://linklet-six.vercel.app/<code_here>`).
- **Interactive Latency Probe:** Real-time latency measurement lab executing 5-burst ping diagnostics.
- **QR Code Generator:** Instant vector QR code rendering for one-click mobile sharing.
- **Branded 404 & 410 HTML Error Handlers:** Clean, dark-mode error screens with a "Return to Linklet" button when links are expired or nonexistent.

---

## 5. Technology Stack

| Layer | Component | Version / Description |
| :--- | :--- | :--- |
| **Backend Runtime** | Python | 3.12+ (managed with `uv`) |
| **API Framework** | FastAPI & Uvicorn | Asynchronous ASGI, Pydantic v2 schemas |
| **Database** | PostgreSQL 17 / Neon | Async SQLAlchemy 2.0 + `asyncpg` with PgBouncer pooling |
| **Migrations** | Alembic | Fully automated schema migrations on startup |
| **Distributed Cache** | Redis 7 | `redis.asyncio` connection pooling, key TTLs, and tombstones |
| **Message Broker** | RabbitMQ 4 | Topic exchanges, publisher confirms, prefetch 50, DLQ |
| **Frontend Framework**| Next.js 15 (App Router)| React 19, TypeScript 5, Tailwind CSS v3 |
| **Load Testing** | Locust 2.x | Distributed virtual user stress testing & latency histograms |
| **Cloud Hosting** | Vercel + Render | Edge CDN frontend + serverless autoscaling backend |

---

## 6. Performance & Stress Testing Benchmarks

Performance was rigorously benchmarked using [Locust](https://locust.io) across high-concurrency read/write scenarios against a 4-worker FastAPI cluster backed by PostgreSQL 17, Redis 7, and RabbitMQ 4.

### 6.1 Controlled Sustained Load Diagnostic (500 Virtual Users)

To isolate true server processing time from client-side socket queueing and redirect-following skew, the server was instrumented with a **pure-ASGI response timing middleware** measuring exact frame write duration (`await send(body)`):

- **Workload Concurrency:** 500 virtual users (FastHttpUser, 30-second duration)
- **Total Requests Processed:** **58,145 requests**
- **Sustained Throughput:** **2,002.1 req/s**
- **Success Rate:** **99.998%** (58,144 out of 58,145 succeeded)

#### Server-Side Latency Distribution (Pure ASGI Middleware)

| Metric | Server Latency | Locust Client Latency |
| :--- | :--- | :--- |
| **Median (p50)** | **16.7 ms** | 150.0 ms |
| **90th Percentile (p90)** | **42.2 ms** | 220.0 ms |
| **95th Percentile (p95)** | **61.7 ms** | 240.0 ms |
| **99th Percentile (p99)** | **97.4 ms** | 1,400.0 ms |
| **Maximum** | **244.0 ms** | 3,026.7 ms |

```text
Pure ASGI Server Latency Histogram (58,145 Total Requests):
  <= 10 ms:    [##########          ]   8,460 reqs (14.5%)
  <= 25 ms:    [####################]  37,742 reqs (64.9%)  -->  79.4% <= 25ms
  <= 50 ms:    [########            ]   7,419 reqs (12.8%)  -->  92.2% <= 50ms
  <= 100 ms:   [####                ]   4,042 reqs ( 7.0%)  -->  99.2% <= 100ms
  <= 250 ms:   [#                   ]     482 reqs ( 0.8%)
  >  250 ms:   [                    ]       0 reqs ( 0.0%)
```

- **99.17%** of all requests completed inside the server in **$< 100\text{ ms}$**.
- **100.00%** of all requests completed inside the server in **$< 244\text{ ms}$**.
- **Zero requests** exceeded $250\text{ ms}$ across all four Uvicorn worker processes.

### 6.2 SQLite vs. PostgreSQL 17 Write Contention (`POST /api/v1/urls`)

During initial baseline benchmarks with SQLite, concurrent writes experienced severe lock contention due to SQLite's file-exclusive write lock. Replacing SQLite with PostgreSQL 17 row-level concurrency completely eliminated this bottleneck:

| Concurrency Level | SQLite Single Writer (Baseline) | PostgreSQL 17 + asyncpg | Improvement Factor |
| :--- | :--- | :--- | :--- |
| **50 Concurrent Users** | 37 ms median | **15 ms median** | **2.5x faster** |
| **250 Concurrent Users** | 730 ms median | **130 ms median** | **5.6x faster** |
| **500 Concurrent Users** | 4,900 ms median | **160 ms median** | **30.6x faster writes** |
| **1,000 Concurrent Users** | 4,300 ms median | **160 ms median** | **26.8x faster writes** |
| **1,000 Users (p90 Write)** | 9,600 ms p90 | **280 ms p90** | **34.3x reduction in write tail** |

### 6.3 Per-Worker Load Distribution

Across a 4-worker cluster under 500 concurrent users:

| Worker Node | Process PID | Processed Requests | p50 | p95 | p99 | Max |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Worker 8001** | PID 20028 | 14,547 reqs | 16.6 ms | 74.4 ms | 103.8 ms | 212.6 ms |
| **Worker 8002** | PID 276 | 14,274 reqs | 16.2 ms | 50.6 ms | 91.7 ms | 244.0 ms |
| **Worker 8003** | PID 20000 | 14,713 reqs | 17.4 ms | 64.8 ms | 91.8 ms | 172.4 ms |
| **Worker 8004** | PID 35076 | 14,611 reqs | 16.7 ms | 56.8 ms | 93.3 ms | 241.0 ms |

---

## 7. REST API Documentation

### Authentication Endpoints

| Method | Endpoint | Request Body | Status Code | Description |
| :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/auth/register` | `{"email": "...", "password": "..."}` | `201 Created` | Create new account with Bcrypt password |
| `POST` | `/api/v1/auth/login` | `{"email": "...", "password": "..."}` | `200 OK` | Authenticate existing user |
| `POST` | `/api/v1/auth/google` | `{"credential": "<google_jwt_token>"}` | `200 OK` | Verify Google OAuth credential |
| `GET` | `/api/v1/auth/me` | Bearer Token | `200 OK` | Fetch authenticated user profile |
| `POST` | `/api/v1/auth/logout` | Bearer Token | `200 OK` | Invalidate active session in Redis |

### URL Management Endpoints

| Method | Endpoint | Headers / Parameters | Status Code | Description |
| :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/urls` | `Idempotency-Key` (Optional) | `201 Created` | Generate short link with optional custom alias |
| `GET` | `/api/v1/urls` | `?status=all&limit=20&offset=0` | `200 OK` | List user's links with pagination and click counts |
| `GET` | `/api/v1/urls/{code}/stats` | Code path parameter | `200 OK` | Retrieve aggregated analytics and click metrics |
| `DELETE` | `/api/v1/urls/{code}` | Code path parameter | `204 No Content` | Disable short link (Transactional Outbox tombstone) |
| `POST` | `/api/v1/urls/{code}/enable` | Code path parameter | `200 OK` | Re-enable previously disabled short link |

### Public Redirect Endpoints

| Method | Endpoint | Status Code | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/{code}` | `302 Found` | Follow short URL to destination; enqueues click event |
| `HEAD` | `/{code}` | `302 Found` | Inspect redirect target headers without counting clicks |
| `GET` | `/health` | `200 OK` | Health probe returning service readiness status |

Interactive OpenAPI (Swagger) documentation is available locally at `http://localhost:8000/docs`.

---

## 8. Local Development Setup

### Prerequisites

- **Python 3.12+** and [`uv`](https://astral.sh/uv)
- **Node.js 20+** and `npm`
- **Docker & Docker Compose** (for PostgreSQL, Redis, and RabbitMQ)

### 1. Clone & Start Infrastructure

```bash
git clone https://github.com/VishalPainjane/Linklet.git
cd Linklet

# Start PostgreSQL 17, Redis 7, and RabbitMQ 4
docker compose -f infrastructure/docker-compose.yml up -d
```

### 2. Configure Backend

```bash
cd backend

# Install dependencies with uv
uv sync --all-groups

# Run database migrations
uv run alembic upgrade head

# Start API server on port 8000
uv run uvicorn linklet.main:app --reload --host 127.0.0.1 --port 8000
```

Interactive Swagger API Documentation will be available at [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs).

### 3. Configure Frontend

```bash
cd ../frontend

# Install dependencies
npm install

# Start development server on port 3000
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the application.

### 4. Run Test Suite

```bash
cd ../backend

# Run Pytest (48 unit, integration, and concurrency tests)
uv run pytest

# Typecheck with Mypy (strict mode)
uv run mypy src

# Lint with Ruff
uv run ruff check .
```

---

## 9. Production Deployment Guide

### A. Render (Backend API)

1. Connect your repository on [Render](https://render.com) using **Web Service** (Root Directory: `backend`).
2. **Build Command:** `pip install -r requirements.txt && pip install -e .`
3. **Start Command:** `alembic upgrade head && uvicorn linklet.main:app --host 0.0.0.0 --port $PORT`
4. **Environment Variables:**
   - `DATABASE_URL`: Your Neon PostgreSQL connection string (e.g. `postgresql://...neon.tech/neondb?sslmode=require`)
   - `ALLOWED_CORS_ORIGINS`: `*` (or `https://linklet-six.vercel.app`)
   - `PUBLIC_SHORT_BASE_URL`: `https://linklet-six.vercel.app`
   - `GOOGLE_CLIENT_ID`: Google OAuth 2.0 Client ID
   - `GOOGLE_CLIENT_SECRET`: Google OAuth 2.0 Client Secret

### B. Vercel (Frontend Next.js)

1. Connect your repository on [Vercel](https://vercel.com) (Root Directory: `frontend`).
2. **Environment Variables:**
   - `NEXT_PUBLIC_API_BASE_URL`: Your backend URL (e.g. `https://<your-service>.onrender.com`)
   - `NEXT_PUBLIC_GOOGLE_CLIENT_ID`: Google OAuth 2.0 Client ID

### C. Google Cloud Console

In your OAuth 2.0 Web Client credentials:
- **Authorized JavaScript Origins:**
  - `https://linklet-six.vercel.app`
  - `http://localhost:3000`
  - `http://localhost:3001`
- **Authorized Redirect URIs:**
  - `https://linklet-six.vercel.app`

---

## 10. Repository Structure

```text
Linklet/
├── .github/workflows/ci.yml         # Dual-pipeline CI (Python uv + Node.js 22)
├── backend/                         # Python 3.12 FastAPI backend
│   ├── alembic/                     # Database migration revisions
│   │   └── versions/                # 001_schema, outbox_events, user_passwords
│   ├── pyproject.toml               # Package dependencies & tool configs
│   ├── requirements.txt             # Frozen dependencies for production deploy
│   ├── src/linklet/
│   │   ├── main.py                  # Lifespan lifecycle & ASGI response timing
│   │   ├── config.py                # Pydantic Settings with CORS & SSL normalizer
│   │   ├── database.py              # Async SQLAlchemy engine with pooler cache-size=0
│   │   ├── api/routes/              # auth, urls, redirects, health
│   │   ├── cache/                   # RedisUrlCache & LocalUrlCacheAdapter
│   │   ├── messaging/               # RabbitMQTopology, BoundedAsyncClickPublisher
│   │   ├── models/                  # User, Url, OutboxEvent, UrlStats
│   │   ├── services/                # UrlService, RedirectService, CodeGenerator
│   │   └── workers/                 # ClickConsumer, OutboxWorker
│   └── tests/                       # 48 unit, integration & concurrency tests
├── frontend/                        # Next.js 15 App Router web app
│   ├── src/app/
│   │   ├── [code]/page.tsx          # Dynamic client redirect handler
│   │   ├── layout.tsx               # Root dark-mode layout
│   │   └── page.tsx                 # Dashboard & landing page
│   ├── src/components/              # AuthModal, ResultCard, LatencyProbe, LinksTable
│   └── src/lib/api.ts               # Origin-aware API client
├── infrastructure/                  # Production Docker Compose topology
│   └── docker-compose.yml           # PostgreSQL 17, Redis 7, RabbitMQ 4
├── loadtests/                       # Locust load test scenarios
│   ├── locustfile.py                # Mixed read/write benchmark
│   └── scenarios/                   # Hot-key redirect and write throughput stress
├── render.yaml                      # Render Infrastructure-as-Code specification
└── README.md                        # Master documentation
```

---

## 11. License

Linklet is released under the **MIT License**. Created and maintained by [Vishal Painjane](https://github.com/VishalPainjane).
