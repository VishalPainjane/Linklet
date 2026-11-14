# Linklet

<div align="center">

**High-Performance Distributed URL Redirection Engine & Systems Architecture**

[![CI Pipeline](https://github.com/VishalPainjane/Linklet/actions/workflows/ci.yml/badge.svg)](https://github.com/VishalPainjane/Linklet/actions/workflows/ci.yml)
[![Live Frontend](https://img.shields.io/badge/Frontend-Vercel-black?logo=vercel)](https://linklet-six.vercel.app)
[![API Engine](https://img.shields.io/badge/API%20Engine-Render-46E3B7?logo=render)](https://linklet-api-ikru.onrender.com/docs)
[![Database](https://img.shields.io/badge/Database-Neon%20Postgres-00E599?logo=postgresql)](https://neon.tech)
[![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python)](https://python.org)
[![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](https://nextjs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[**Live Application**](https://linklet-six.vercel.app) • [**Swagger API Documentation**](https://linklet-api-ikru.onrender.com/docs) • [**Benchmark Laboratory**](results/README.md)

</div>

---

## 1. Introduction

Linklet is a production-grade URL shortening and redirection platform designed for high concurrency and heavy read-write asymmetry. In standard web applications, URL shorteners experience read-to-write ratios exceeding 99:1. When a link goes viral or is distributed across social media or email campaigns, thousands of concurrent requests query the exact same identifier simultaneously.

Naive implementations collapse under traffic spikes because they perform synchronous database updates (such as incrementing click counters) directly inside the HTTP request loop, causing row-level database lock contention and connection pool exhaustion.

Linklet solves this architectural bottleneck by decoupling the high-speed read path from asynchronous background write operations, ensuring redirects resolve in milliseconds regardless of traffic volume.

---

## 2. Architecture & System Design

Linklet separates read, write, and telemetry flows into dedicated stages:

### Critical Read Path (`GET /{code}`)
- **Cache-Aside Memory Lookup:** Incoming requests query Redis first. Cached URLs resolve immediately in approximately 16 ms without touching the relational database.
- **Microsecond Telemetry Buffering:** Click metadata (timestamp, user agent, referrer, IP) is pushed to a bounded in-memory buffer in microseconds, allowing the HTTP 307 Temporary Redirect response to return to the client without waiting for disk persistence.
- **Graceful Fallback:** If a cache miss occurs, the backend fetches the destination URL from PostgreSQL, writes it to Redis with a 15-minute time-to-live (TTL), and executes the redirect.

### Asynchronous Analytics & Event Processing
- **RabbitMQ Message Broker:** Background workers drain buffered click events to durable RabbitMQ queues using persistent topic exchanges and publisher confirmations.
- **Idempotent Batch Ingestion:** Consumer daemons process click batches and atomically update analytics counters in PostgreSQL using deduplication ledgers, guaranteeing exact-once counting even during consumer restarts.

### Cache Consistency & Invalidation
- **Transactional Outbox Pattern:** When a link is disabled or deleted, the update and an outbox event are committed within the same database transaction.
- **Tombstone Caching:** A background relay worker syncs invalidation events to Redis as tombstones with a 1-hour TTL. Subsequent requests for deleted links immediately return HTTP 410 Gone directly from memory, preventing cache drift and eliminating redundant database lookups.

---

## 3. Performance & Empirical Benchmarks

Linklet was validated under high-concurrency synthetic and sustained workloads backed by **PostgreSQL 17**, **Redis 7**, and **RabbitMQ 4**.

### Key Benchmark Results:
- **Sustained Throughput:** **2,002.1 requests/sec** under continuous 500-user load (58,145 total requests processed).
- **Service Availability:** **99.998% success rate** (58,144 out of 58,145 succeeded; 1 transient network failure).
- **Server Response Latency:**
  - **Median (p50):** **16.7 ms**
  - **90th Percentile (p90):** **42.2 ms**
  - **99th Percentile (p99):** **97.4 ms**
  - **Maximum:** **244.0 ms**
- **Strict SLA Boundary:** **79.4%** of all requests completed in $\le 25\text{ ms}$, **99.2%** completed in $\le 100\text{ ms}$, and **zero requests** exceeded $250\text{ ms}$.
- **Write Scalability:** Migrating from single-writer SQLite to PostgreSQL 17 with connection pooling reduced p90 write latency by **34.3x** (from 9,600 ms down to 280 ms at 1,000 concurrent writers).
- **Load Balancing:** In a 4-worker cluster, traffic was distributed with near-perfect uniformity (24.5% to 25.3% per node) with ~16 ms median latency across all workers.

> For the complete multi-concurrency scaling tables (100 to 1,000 users), step-load diagnostics, latency histograms, and raw CSV/JSON test datasets, refer to the [**Benchmark & Performance Reference**](results/README.md).

---

## 4. Data Layer, Caching & Messaging

Linklet isolates high-speed traffic from persistent storage using three specialized systems:

- **PostgreSQL 17 (Persistence):** Primary ACID source of truth for users and URLs. Utilizes row-level locking (MVCC) and connection pooling via `asyncpg` so concurrent writes never block incoming reads.
- **Redis 7 (Caching & State):** High-speed in-memory store. Serves cached redirects (`url:{code}`) in ~2 ms, caches deletion tombstones (`tombstone:{code}`) to instantly return HTTP 410 Gone, and enforces sliding window rate limits.
- **RabbitMQ 4 (Event Streaming):** Decouples click analytics from redirects. Clicks are buffered in memory and dispatched asynchronously to durable queues (`url.clicks.v1`), completely eliminating database lock contention during traffic spikes.

---

## 5. Authentication

Linklet uses standard token-based authentication with Bcrypt password hashing:

- **Access Token:** Short-lived signed JWT used in the `Authorization: Bearer <token>` header to authenticate API requests. Valid for 15 minutes.
- **Refresh Token:** Long-lived token used to obtain a new access token without re-authenticating. Valid for 7 days (10,080 minutes).
- **Core Endpoints:** Registration (`/register`), Login (`/login`), Profile (`/me`), and Logout (`/logout`).

---

## 6. Database Schema

The database consists of five core relational tables:

### `users`
Stores registered user accounts and credentials.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | UUID | Primary Key | Unique user identifier |
| `email` | VARCHAR(255) | Unique, Indexed | User email address |
| `password_hash` | VARCHAR(255) | Nullable | 12-round Bcrypt salted hash |
| `created_at` | TIMESTAMPTZ | Not Null | Account creation timestamp |

### `urls`
Stores shortened URLs, destination targets, and lifecycle status.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `code` | VARCHAR(32) | Primary Key | 8-character Base62 short code or custom alias |
| `destination_url` | TEXT | Not Null | Original long destination URL |
| `owner_id` | UUID | Foreign Key (`users.id`) | Optional owner account reference |
| `is_custom` | BOOLEAN | Default False | Indicates whether code is a custom alias |
| `created_at` | TIMESTAMPTZ | Not Null | Timestamp of link creation |
| `expires_at` | TIMESTAMPTZ | Nullable | Optional link expiration date |
| `disabled_at` | TIMESTAMPTZ | Nullable | Timestamp if link was deactivated/deleted |

### `url_stats`
Maintains aggregated click counters and access history for each link.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `code` | VARCHAR(32) | Primary Key, FK (`urls.code`) | Target URL identifier |
| `click_count` | BIGINT | Default 0, Not Null | Total recorded redirects |
| `last_clicked_at` | TIMESTAMPTZ | Nullable | Timestamp of most recent redirect |
| `updated_at` | TIMESTAMPTZ | Not Null | Timestamp of last counter increment |

### `click_events`
Stores individual raw click records for granular analytics and reporting.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `event_id` | UUID | Primary Key | Unique click event identifier |
| `code` | VARCHAR(32) | Foreign Key (`urls.code`) | Associated short code |
| `occurred_at` | TIMESTAMPTZ | Not Null | Timestamp when redirect occurred |
| `referrer_host` | TEXT | Nullable | HTTP Referer hostname |
| `user_agent_family` | VARCHAR(64) | Nullable | Browser/client family (e.g., Chrome, Safari) |
| `country_code` | VARCHAR(2) | Nullable | Two-letter ISO country code |

### `outbox_events`
Implements the transactional outbox pattern to guarantee reliable event dispatch and cache invalidation.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | UUID | Primary Key | Unique outbox event identifier |
| `event_type` | VARCHAR(64) | Not Null | Event name (e.g., `URL_DISABLED`) |
| `aggregate_type` | VARCHAR(64) | Default "URL" | Entity category |
| `aggregate_id` | VARCHAR(64) | Not Null | Entity key (e.g., URL code) |
| `payload` | JSONB | Not Null | Event payload data |
| `created_at` | TIMESTAMPTZ | Not Null | Creation timestamp |
| `processed_at` | TIMESTAMPTZ | Nullable | Timestamp when published to broker/cache |
| `retry_count` | INTEGER | Default 0 | Number of processing attempts |
| `last_error` | VARCHAR(512) | Nullable | Error message if processing failed |

---

## 7. Key Numeric Configurations

Core connection pooling, caching, and concurrency thresholds:

| Parameter | Default Value | Description |
| :--- | :--- | :--- |
| **DB_POOL_SIZE** | `10` | Baseline persistent database connection pool size |
| **DB_MAX_OVERFLOW** | `5` | Maximum temporary connections allowed during traffic surges |
| **DB_POOL_TIMEOUT** | `5.0` | Maximum wait time in seconds for a pool socket |
| **DB_POOL_RECYCLE** | `300` | Seconds before recycling idle connections to prevent stale sockets |
| **REDIS_MAX_CONNECTIONS** | `50` | Maximum concurrent connections in the Redis connection pool |
| **CACHE_DEFAULT_TTL_SECONDS** | `900` | URL cache expiration duration in seconds (15 minutes) |
| **AMQP_PREFETCH** | `50` | Message batch prefetch limit for analytics consumer workers |
| **JWT_EXPIRE_MINUTES** | `10080` | Refresh token expiration window in minutes (7 days) |
