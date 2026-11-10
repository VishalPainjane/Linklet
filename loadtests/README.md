# Linklet Load Testing Laboratory

Performance, concurrency, and tail-latency experiments using **Locust**.

## Workload Profiles

1. **Standard Mixed Workload (`locustfile.py`)**:
   - 99% Redirect (`GET /{code}`) lookups with HTTP 302 and `Cache-Control: no-store`.
   - 1% URL Creation (`POST /api/v1/urls`).
2. **Hot Key Stress (`scenarios/redirect_hotkey.py`)**:
   - 100% Reads hitting a single popular short code.
   - Evaluates Redis cache-aside hit ratio, stampede prevention, and single-flight lock overhead.
3. **Write Throughput Benchmark (`scenarios/create_benchmark.py`)**:
   - 100% Writes creating distinct URLs.
   - Evaluates PostgreSQL connection pool exhaustion, write amplification, and Base62 collision avoidance.

---

## Running Load Tests

### 1. Interactive Web UI

```bash
cd backend
python -m uv run locust -f ../loadtests/locustfile.py --host http://localhost:8000
```
Open [http://localhost:8089](http://localhost:8089) in your browser, enter user count and spawn rate, and observe real-time latency percentiles (p50, p95, p99).

### 2. Headless Automated Run

```bash
cd backend
python -m uv run locust -f ../loadtests/locustfile.py \
  --host http://localhost:8000 \
  --headless -u 1000 -r 50 -t 1m \
  --csv ../results/benchmark_mixed
```

### 3. Distributed Master/Worker Execution

Start Master:
```bash
python -m uv run locust -f ../loadtests/locustfile.py --master --headless --expect-workers 4 -u 10000 -r 200 -t 5m --host http://target-api:8000
```

Start Worker(s):
```bash
python -m uv run locust -f ../loadtests/locustfile.py --worker --master-host localhost
```

