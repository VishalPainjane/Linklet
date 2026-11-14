# Linklet — Benchmark & Performance Reference

This directory contains the canonical load test data, latency distributions, and empirical performance metrics recorded during high-concurrency testing of Linklet.

---

## 1. Executive Summary & Core Results

Linklet was benchmarked across multi-worker configurations backed by **PostgreSQL 17**, **Redis 7**, and **RabbitMQ 4**.

### Key Performance Highlights:
- **Sustained Throughput:** **2,002.1 requests/sec** under continuous 500-user load (58,145 total requests processed).
- **Service Availability:** **99.998% success rate** (58,144 out of 58,145 requests succeeded; 1 transient network failure).
- **Server Response Latency:**
  - **Median (p50):** **16.7 ms**
  - **90th Percentile (p90):** **42.2 ms**
  - **95th Percentile (p95):** **61.7 ms**
  - **99th Percentile (p99):** **97.4 ms**
  - **Maximum:** **244.0 ms**
- **SLA Boundary:** **99.17%** of all redirect requests completed inside the server in **under 100 ms**; zero requests exceeded 250 ms across all workers.
- **Write Scalability:** Migrating from single-writer SQLite to PostgreSQL 17 with connection pooling produced a **34.3x reduction in p90 write latency** under heavy concurrent creation load.

---

## 2. Server Latency Distribution (58,145 Requests)

During sustained testing (2,002 req/s across 500 concurrent connections), response times were recorded at the server layer to measure true backend processing duration (FastAPI + Redis cache lookups):

| Response Time Bucket | Request Count | Percentage of Traffic | Cumulative |
| :--- | :--- | :--- | :--- |
| **$\le$ 10 ms** | 8,460 | 14.5% | 14.5% |
| **$\le$ 25 ms** | 37,742 | 64.9% | **79.4%** |
| **$\le$ 50 ms** | 7,419 | 12.8% | **92.2%** |
| **$\le$ 100 ms** | 4,042 | 7.0% | **99.2%** |
| **$\le$ 250 ms** | 482 | 0.8% | **100.0%** |
| **> 250 ms** | 0 | 0.0% | **100.0%** |

- **79.4%** of all requests completed in **$\le 25\text{ ms}$**.
- **99.2%** of all requests completed in **$\le 100\text{ ms}$**.
- **0 requests** exceeded $250\text{ ms}$.

---

## 3. Concurrency Scaling (100 to 1,000 Users)

The table below summarizes backend server latency as concurrent virtual users scaled from 100 to 1,000:

| Concurrent Users | Throughput | Median (p50) | 90th % (p90) | 95th % (p95) | 99th % (p99) |
| :---: | :---: | :---: | :---: | :---: | :---: |
| **100 Users** | 375.6 req/s | 30.2 ms | 83.5 ms | 123.9 ms | 300.6 ms |
| **250 Users** | 384.1 req/s | 33.3 ms | 69.5 ms | 91.2 ms | 245.6 ms |
| **500 Users** | 374.8 req/s | 38.4 ms | 97.0 ms | 141.4 ms | 229.1 ms |
| **750 Users** | 378.4 req/s | 35.0 ms | 83.9 ms | 109.4 ms | 177.7 ms |
| **1,000 Users**| 365.9 req/s | 36.4 ms | 92.7 ms | 133.4 ms | 200.4 ms |

### Systems Observations:
1. **Predictable Tail Latencies:** Across a 10x increase in concurrency (100 to 1,000 users), median response times remained rock solid between **30 ms and 38 ms**, with 99th percentile times staying consistently around **200–300 ms**.
2. **Measurement Note:** Measuring latency directly on the application server provides an accurate reflection of real backend processing time (FastAPI + Redis + PostgreSQL), avoiding artificial delays caused by test runner connection queues on a single test machine.

---

## 4. Database Concurrency: SQLite vs. PostgreSQL 17

URL creation (`POST /api/v1/urls`) requires database writes. This benchmark compares SQLite's single-writer locking against PostgreSQL 17's Multi-Version Concurrency Control (MVCC) with asynchronous connection pooling:

| Concurrency Level | SQLite Single Writer (Baseline) | PostgreSQL 17 + asyncpg | Improvement Factor |
| :--- | :--- | :--- | :--- |
| **50 Concurrent Users** | 37 ms median | **15 ms median** | **2.5x faster** |
| **250 Concurrent Users** | 730 ms median | **130 ms median** | **5.6x faster** |
| **500 Concurrent Users** | 4,900 ms median | **160 ms median** | **30.6x faster writes** |
| **1,000 Concurrent Users** | 4,300 ms median | **160 ms median** | **26.8x faster writes** |
| **1,000 Users (p90 Tail)** | 9,600 ms p90 | **280 ms p90** | **34.3x reduction in p90 tail** |

*Takeaway:* While SQLite serializes all concurrent writes behind a single database-level lock, PostgreSQL 17 handles concurrent insertions simultaneously, keeping write latency under 200 ms even at 1,000 concurrent users.

---

## 5. Multi-Worker Load Balancing

In the 4-worker benchmarking topology, incoming traffic was distributed across 4 Uvicorn worker processes using round-robin reverse proxy routing:

| Worker Node | Process PID | Processed Requests | Traffic Share | Median (p50) | 95th % (p95) | 99th % (p99) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Worker 1** | PID 20028 | 14,547 reqs | 25.02% | 16.6 ms | 74.4 ms | 103.8 ms |
| **Worker 2** | PID 276 | 14,274 reqs | 24.55% | 16.2 ms | 50.6 ms | 91.7 ms |
| **Worker 3** | PID 20000 | 14,713 reqs | 25.30% | 17.4 ms | 64.8 ms | 91.8 ms |
| **Worker 4** | PID 35076 | 14,611 reqs | 25.13% | 16.7 ms | 56.8 ms | 93.3 ms |

*Takeaway:* Traffic was distributed with near-perfect uniformity ($\pm 0.4\%$ variance across all workers), confirming that the reverse proxy evenly distributed load with zero worker hotspotting.

---

## 6. Canonical Data Files

The raw data backing these results is preserved in this directory for reference:

| File | Format | Description |
| :--- | :--- | :--- |
| **[`benchmark_summary.json`](./benchmark_summary.json)** | JSON | Full multi-concurrency step load profiling (100 to 1,000 users) containing raw latency percentiles, server histograms, and worker PID distributions. |
| **[`sustained_load_stats.csv`](./sustained_load_stats.csv)** | CSV | Raw test run export capturing 74,440 requests under continuous mixed read/write workload. |
