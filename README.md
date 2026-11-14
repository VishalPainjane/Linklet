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

Linklet was benchmarked under synthetic and sustained workloads across multi-worker clusters backed by PostgreSQL 17, Redis 7, and RabbitMQ 4.

### 3.1 Sustained Load Performance (500 Concurrent Users)
Under continuous sustained load testing, response times were recorded directly at the server layer to evaluate genuine backend processing duration:

- **Workload Concurrency:** 500 concurrent virtual users (30-second sustained load)
- **Total Requests Processed:** 58,145 requests
- **Sustained Throughput:** 2,002.1 requests/sec
- **Service Availability:** 99.998% (58,144 out of 58,145 succeeded)
- **Median Response Time (p50):** 16.7 ms
- **90th Percentile (p90):** 42.2 ms
- **95th Percentile (p95):** 61.7 ms
- **99th Percentile (p99):** 97.4 ms
- **Maximum Duration:** 244.0 ms

#### Response Latency Distribution
- **Within 10 ms:** 8,460 requests (14.5%)
- **Within 25 ms:** 37,742 requests (64.9%) — **79.4% cumulative**
- **Within 50 ms:** 7,419 requests (12.8%) — **92.2% cumulative**
- **Within 100 ms:** 4,042 requests (7.0%) — **99.2% cumulative**
- **Within 250 ms:** 482 requests (0.8%) — **100.0% cumulative**
- **Exceeding 250 ms:** 0 requests (0.0%)

### 3.2 Concurrency Scaling (100 to 1,000 Users)
System stability and latency consistency were evaluated as concurrent virtual users scaled from 100 to 1,000:

| Concurrent Users | Throughput | Median (p50) | 90th % (p90) | 95th % (p95) | 99th % (p99) |
| :---: | :---: | :---: | :---: | :---: | :---: |
| **100 Users** | 375.6 req/s | 30.2 ms | 83.5 ms | 123.9 ms | 300.6 ms |
| **250 Users** | 384.1 req/s | 33.3 ms | 69.5 ms | 91.2 ms | 245.6 ms |
| **500 Users** | 374.8 req/s | 38.4 ms | 97.0 ms | 141.4 ms | 229.1 ms |
| **750 Users** | 378.4 req/s | 35.0 ms | 83.9 ms | 109.4 ms | 177.7 ms |
| **1,000 Users**| 365.9 req/s | 36.4 ms | 92.7 ms | 133.4 ms | 200.4 ms |

Across a 10x increase in concurrency, median server latency remained consistent between 30 ms and 38 ms, demonstrating resilience against traffic spikes.

### 3.3 Database Write Scaling: SQLite vs. PostgreSQL 17
URL creation (`POST /api/v1/urls`) requires database writes. This test measures the write latency improvements gained by migrating from SQLite single-writer locking to PostgreSQL 17 Multi-Version Concurrency Control (MVCC) with asynchronous connection pooling:

| Concurrency Level | SQLite Single Writer (Baseline) | PostgreSQL 17 + asyncpg | Improvement Factor |
| :--- | :--- | :--- | :--- |
| **50 Concurrent Users** | 37 ms median | 15 ms median | 2.5x faster |
| **250 Concurrent Users** | 730 ms median | 130 ms median | 5.6x faster |
| **500 Concurrent Users** | 4,900 ms median | 160 ms median | 30.6x faster writes |
| **1,000 Concurrent Users** | 4,300 ms median | 160 ms median | 26.8x faster writes |
| **1,000 Users (p90 Tail)** | 9,600 ms p90 | 280 ms p90 | 34.3x reduction in tail latency |

### 3.4 Multi-Worker Load Balancing
In a 4-worker cluster topology, incoming requests were distributed across worker processes via round-robin reverse proxy routing:

| Worker Node | Processed Requests | Traffic Share | Median (p50) | 95th % (p95) | 99th % (p99) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Worker 1** | 14,547 requests | 25.02% | 16.6 ms | 74.4 ms | 103.8 ms |
| **Worker 2** | 14,274 requests | 24.55% | 16.2 ms | 50.6 ms | 91.7 ms |
| **Worker 3** | 14,713 requests | 25.30% | 17.4 ms | 64.8 ms | 91.8 ms |
| **Worker 4** | 14,611 requests | 25.13% | 16.7 ms | 56.8 ms | 93.3 ms |

All workers handled between 24.5% and 25.3% of total traffic, proving balanced load distribution without hot-spotting.

---

## 4. Data Layer, Caching & Messaging

Linklet delegates persistence, memory caching, and event delivery to specialized infrastructure components engineered to eliminate database contention and guarantee high availability:

### 4.1 PostgreSQL 17 (Relational Persistence & Concurrency)
- **Authoritative Source of Truth:** While Redis and in-memory buffers handle high-speed traffic, PostgreSQL maintains ACID durability for user accounts, short code registries, outbox event ledgers, and aggregated analytics.
- **Multi-Version Concurrency Control (MVCC):** Unlike single-writer file-based databases (such as SQLite) that lock the entire database file during writes, PostgreSQL utilizes MVCC and row-level locking. Readers never block writers, and concurrent link creation requests insert into separate rows without contention.
- **Asynchronous Connection Pooling (`asyncpg`):** Opening new database connections incurs significant network latency and SSL handshake overhead. Linklet maintains a pre-warmed asynchronous connection pool (`DB_POOL_SIZE=10`, `DB_MAX_OVERFLOW=5`). Coroutines acquire active sockets in sub-millisecond time and release them immediately upon query completion. Inactive connections are periodically recycled (`DB_POOL_RECYCLE=300`) to prevent stale connections or firewall drops.

### 4.2 Redis 7 / Upstash (In-Memory Caching & State Management)
- **Cache-Aside Read Path (`url:{code}`):** When a redirect request arrives, the backend checks Redis memory first. On a cache hit, the destination URL is returned within 1 to 2 milliseconds, resolving the redirect without querying the database. On a cache miss, the record is retrieved from PostgreSQL, written to Redis with a 15-minute expiration (`CACHE_DEFAULT_TTL_SECONDS=900`), and served to the user.
- **Cache Drift Prevention via Tombstones (`tombstone:{code}`):** In distributed architectures, deleting database rows while simultaneously clearing cache entries introduces race conditions where concurrent reads can re-populate stale data. Linklet solves this using invalidation tombstones. When a link is deleted or deactivated, an explicit tombstone is written to Redis with a 1-hour expiration. Subsequent requests seeing this tombstone immediately return HTTP 410 Gone directly from memory, eliminating cache drift and avoiding database roundtrips.
- **Pipelined Sliding Window Rate Limiting (`rate:create:{ip}`):** Rate limiting prevents endpoint abuse by tracking per-IP request counts inside a sliding 60-second window. Linklet uses atomic Redis pipelines (`pipe.incr` and `pipe.expire`) to evaluate and enforce thresholds in a single network roundtrip without requiring distributed locks or custom scripts.

### 4.3 RabbitMQ 4 (Event Streaming & Telemetry Ingestion)
- **Eliminating Synchronous Database Bottlenecks:** A major bottleneck in URL redirection systems is synchronously incrementing database click counters during the redirect loop. Under viral traffic surges, hundreds of simultaneous clicks on the same link fight for the same row-level database lock, causing database connection pools to exhaust and latency to degrade.
- **Microsecond In-Memory Buffering:** Linklet completely isolates the redirect execution from database writes. When a link is clicked, telemetry metadata (timestamp, user agent, referrer, and country code) is pushed into a bounded in-memory buffer in under 50 microseconds, allowing the HTTP redirect response to return immediately to the visitor.
- **Durable Event Queuing:** Background dispatcher tasks drain the in-memory buffer to RabbitMQ topic exchanges (`analytics.events`) and durable queues (`url.clicks.v1`). Message persistence and publisher confirmations guarantee telemetry records survive process restarts, while dead-letter exchanges (`analytics.dlx`) isolate corrupted messages without blocking delivery.
- **Idempotent Batch Draining:** Background consumer workers ingest click events in batches (`AMQP_PREFETCH=50`) and flush them into PostgreSQL. Deduplication tables (`processed_events`) ensure that if a worker restarts or redelivers a message, events are deduplicated automatically, guaranteeing accurate click counts without locking the user-facing read path.

---

## 5. Authentication & Security

Linklet uses standard, stateless **JSON Web Token (JWT)** authentication:

- **Password Security:** Passwords are encrypted using 12 rounds of salted `bcrypt` hashing with constant-time verification.
- **Stateless Tokens:** Authentication tokens are signed using the `HS256` algorithm with a 7-day expiration. Tokens carry standard identity claims (`sub`, `email`, `iat`, `exp`).
- **Zero-Lookup Authorization:** Protected API routes validate incoming `Authorization: Bearer <token>` headers cryptographically in memory without issuing queries to the database or Redis session stores.
- **Core Endpoints:**
  - `POST /api/v1/auth/register` — Creates an account and returns a JWT Bearer token (HTTP 201).
  - `POST /api/v1/auth/login` — Authenticates credentials and returns a JWT Bearer token (HTTP 200).
  - `GET /api/v1/auth/me` — Returns the authenticated user profile.
  - `POST /api/v1/auth/logout` — Stateless logout on the client side.

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

## 7. Configuration & Environment Settings

Linklet exposes connection pooling, socket caching, and pipeline concurrency controls via environment variables:

| Setting | Default Value | Category | Description |
| :--- | :--- | :--- | :--- |
| **DATABASE_URL** | PostgreSQL connection string | Database | Primary connection string for async database operations |
| **DB_POOL_SIZE** | `10` | Database | Baseline persistent connections maintained in the pool |
| **DB_MAX_OVERFLOW** | `5` | Database | Maximum burst connections allocated during peak spikes |
| **DB_POOL_TIMEOUT** | `5.0` | Database | Seconds to wait for an available socket before raising a timeout |
| **DB_POOL_RECYCLE** | `300` | Database | Seconds before recycling connections to avoid stale connections |
| **REDIS_URL** | `redis://localhost:6379/0` | Cache | Connection URI for the Redis cache cluster |
| **REDIS_MAX_CONNECTIONS** | `50` | Cache | Maximum concurrent connections allowed in the Redis pool |
| **CACHE_DEFAULT_TTL_SECONDS** | `900` | Cache | Expiration time for cached active URL mappings (15 minutes) |
| **AMQP_URL** | `amqp://guest:guest@localhost:5672/` | Messaging | Connection URI for the RabbitMQ event broker |
| **AMQP_PREFETCH** | `50` | Messaging | Prefetch batch limit for background analytics consumers |
| **JWT_SECRET** | Change in production | Security | Cryptographic secret key used to sign and verify JWT tokens |
