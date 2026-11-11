"""Sustained Soak & Warmup Benchmark for Linklet.

Phases:
1. Pre-test DB snapshot (buffer hit ratio, dead tuples, checkpoints).
2. Warmup phase (30s at 100 users) to prime connection pools and caches.
3. Reset ASGI server histograms.
4. Sustained test phase (180s - 300s at 500 users).
5. Post-test DB snapshot & time-windowed latency analysis.
"""

import asyncio
import csv
import json
import os
import subprocess
import sys
import time
import urllib.request
from typing import Any
import asyncpg
import psutil

PORTS = [8001, 8002, 8003, 8004]
PG_URL = "postgresql://linklet:local-only-change-me@localhost:5433/linklet"
WARMUP_USERS = 100
WARMUP_DURATION = "30s"
TEST_USERS = 500
TEST_DURATION = "180s"  # 3 minutes sustained run to capture checkpoints and bloat


async def fetch_pg_diagnostics() -> dict[str, Any]:
    try:
        conn = await asyncpg.connect(PG_URL, timeout=3.0)
        # Checkpoint stats (in PG 17 pg_stat_checkpointer exists, fallback to pg_stat_bgwriter)
        try:
            cp_row = await conn.fetchrow(
                "SELECT num_timed, num_requested, write_time, sync_time FROM pg_stat_checkpointer;"
            )
            cp_data = dict(cp_row) if cp_row else {}
        except Exception:
            cp_row = await conn.fetchrow(
                "SELECT checkpoints_timed as num_timed, checkpoints_req as num_requested, "
                "checkpoint_write_time as write_time, checkpoint_sync_time as sync_time FROM pg_stat_bgwriter;"
            )
            cp_data = dict(cp_row) if cp_row else {}

        # Tuple stats
        tuple_rows = await conn.fetch(
            "SELECT relname, n_live_tup, n_dead_tup, last_vacuum, last_autovacuum "
            "FROM pg_stat_user_tables WHERE relname IN ('urls', 'url_stats', 'processed_events');"
        )
        tuple_data = {r["relname"]: dict(r) for r in tuple_rows}

        # Cache hit ratio
        hit_ratio = await conn.fetchval(
            "SELECT round((sum(heap_blks_hit) * 100.0 / nullif(sum(heap_blks_hit) + sum(heap_blks_read), 0))::numeric, 2) "
            "FROM pg_statio_user_tables;"
        )

        total_urls = await conn.fetchval("SELECT count(*) FROM urls;")
        await conn.close()

        return {
            "checkpoints": cp_data,
            "tables": tuple_data,
            "buffer_hit_ratio_pct": float(hit_ratio) if hit_ratio is not None else 100.0,
            "total_urls": total_urls,
        }
    except Exception as exc:
        return {"error": str(exc)}


def reset_worker_asgi_counters() -> None:
    print("Resetting server-side ASGI counters across all 4 workers...")
    for port in PORTS:
        try:
            req = urllib.request.Request(f"http://127.0.0.1:{port}/diagnostics/asgi?reset=true")
            with urllib.request.urlopen(req, timeout=2.0) as resp:
                data = json.loads(resp.read().decode())
                print(f"  Worker {port} (PID {data.get('pid')}) ASGI counters reset.")
        except Exception as exc:
            print(f"  Warning: Worker {port} reset failed: {exc}")


def fetch_worker_asgi_stats() -> tuple[dict[str, int], list[float]]:
    total_counters = {
        "total": 0,
        "le_10": 0,
        "le_25": 0,
        "le_50": 0,
        "le_100": 0,
        "le_250": 0,
        "le_500": 0,
        "le_1000": 0,
        "gt_1000": 0,
    }
    all_samples: list[float] = []

    for port in PORTS:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/diagnostics/asgi", timeout=3.0) as resp:
                data = json.loads(resp.read().decode())
                for k in total_counters.keys():
                    total_counters[k] += data.get("counters", {}).get(k, 0)
                all_samples.extend(data.get("samples", []))
        except Exception as exc:
            print(f"  Warning: Worker {port} fetch failed: {exc}")

    return total_counters, all_samples


def compute_percentiles(samples: list[float]) -> dict[str, float]:
    if not samples:
        return {"p50": 0.0, "p90": 0.0, "p95": 0.0, "p99": 0.0, "max": 0.0}
    s = sorted(samples)
    n = len(s)
    return {
        "p50": round(s[int(n * 0.50)], 2),
        "p90": round(s[int(n * 0.90)], 2),
        "p95": round(s[int(n * 0.95)], 2),
        "p99": round(s[int(n * 0.99)], 2),
        "max": round(s[-1], 2),
    }


def parse_csv_history(csv_prefix: str) -> list[dict]:
    history_file = f"{csv_prefix}_stats_history.csv"
    snapshots = []
    if os.path.exists(history_file):
        with open(history_file, mode="r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                if row.get("Name") == "GET /{code}":
                    snapshots.append({
                        "timestamp": row.get("Timestamp"),
                        "requests": int(row.get("Total Request Count") or row.get("Request Count") or 0),
                        "failures": int(row.get("Total Failure Count") or row.get("Failure Count") or 0),
                        "rps": float(row.get("Requests/s", 0) or 0),
                        "p50": float(row.get("50%", 0) or 0),
                        "p95": float(row.get("95%", 0) or 0),
                        "p99": float(row.get("99%", 0) or 0),
                    })
    return snapshots


def run_locust(users: int, spawn_rate: int, duration: str, csv_prefix: str, log_path: str) -> None:
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    backend_dir = os.path.join(repo_root, "backend")
    venv_python = os.path.join(backend_dir, ".venv", "Scripts", "python.exe")
    python_bin = venv_python if os.path.exists(venv_python) else sys.executable

    env = os.environ.copy()
    env["LINKLET_TARGET_NODES"] = (
        "http://127.0.0.1:8001,http://127.0.0.1:8002,http://127.0.0.1:8003,http://127.0.0.1:8004"
    )

    cmd = [
        python_bin,
        "-m",
        "locust",
        "-f",
        "loadtests/locustfile.py",
        "--headless",
        "--host",
        "http://127.0.0.1:8001",
        "-u",
        str(users),
        "-r",
        str(spawn_rate),
        "--run-time",
        duration,
        "--csv",
        csv_prefix,
    ]

    with open(log_path, "w", encoding="utf-8") as f:
        proc = subprocess.Popen(cmd, stdout=f, stderr=subprocess.STDOUT, env=env)
        proc.wait()


async def main() -> None:
    os.makedirs("results", exist_ok=True)
    print("==================================================================")
    print("  SUSTAINED BENCHMARK: WARMUP vs. STEADY-STATE POSTGRESQL ANALYSIS")
    print("==================================================================")

    # 1. Pre-test diagnostic snapshot
    print("\n1. Capturing Initial PostgreSQL Diagnostics...")
    initial_pg = await fetch_pg_diagnostics()
    if "error" in initial_pg:
        print(f"  Error connecting to PostgreSQL: {initial_pg['error']}")
        print("  Please ensure Docker containers are running.")
        return

    print(f"  - Total URLs in DB:      {initial_pg.get('total_urls')}")
    print(f"  - Buffer Hit Ratio:      {initial_pg.get('buffer_hit_ratio_pct')}%")
    print(f"  - Initial Checkpoints:   {initial_pg.get('checkpoints', {})}")
    print(f"  - Initial Table Tuples:  {initial_pg.get('tables', {})}")

    # 2. Phase 1: Warmup Phase
    print(f"\n2. Starting Warmup Phase ({WARMUP_USERS} users, {WARMUP_DURATION})...")
    print("   (Warming connection pools, JIT compilation, and OS buffer caches)")
    run_locust(
        users=WARMUP_USERS,
        spawn_rate=20,
        duration=WARMUP_DURATION,
        csv_prefix="results/sustained_warmup",
        log_path="results/sustained_warmup.log",
    )
    print("   Warmup complete. Discarding startup metrics.")

    # 3. Reset Server-Side Histograms
    print("\n3. Resetting Pure-ASGI Histograms for Steady-State Measurement...")
    reset_worker_asgi_counters()
    time.sleep(1.0)

    # 4. Phase 2: Sustained Steady-State Test
    print(f"\n4. Starting Sustained Test ({TEST_USERS} users, {TEST_DURATION})...")
    run_locust(
        users=TEST_USERS,
        spawn_rate=100,
        duration=TEST_DURATION,
        csv_prefix="results/sustained_steady",
        log_path="results/sustained_steady.log",
    )
    print("   Sustained run finished.")

    # 5. Post-test diagnostic snapshot
    print("\n5. Capturing Post-Test PostgreSQL Diagnostics...")
    final_pg = await fetch_pg_diagnostics()
    total_counters, all_samples = fetch_worker_asgi_stats()
    asgi_pct = compute_percentiles(all_samples)
    history = parse_csv_history("results/sustained_steady")

    # 6. Output Final Report
    print("\n" + "=" * 70)
    print("               SUSTAINED BENCHMARK RESULTS REPORT")
    print("=" * 70)

    print("\nPOSTGRESQL EVOLUTION OVER RUN:")
    print(f"  - Initial Buffer Hit Ratio: {initial_pg.get('buffer_hit_ratio_pct')}% -> Final: {final_pg.get('buffer_hit_ratio_pct')}%")
    init_cp = initial_pg.get("checkpoints", {})
    final_cp = final_pg.get("checkpoints", {})
    print(f"  - Checkpoints Triggered:    Timed: {final_cp.get('num_timed', 0) - init_cp.get('num_timed', 0)} | Requested: {final_cp.get('num_requested', 0) - init_cp.get('num_requested', 0)}")
    
    print("\nTABLE BLOAT / TUPLE GROWTH:")
    for tbl in ["urls", "url_stats"]:
        i_tup = initial_pg.get("tables", {}).get(tbl, {})
        f_tup = final_pg.get("tables", {}).get(tbl, {})
        live_delta = f_tup.get("n_live_tup", 0) - i_tup.get("n_live_tup", 0)
        dead_delta = f_tup.get("n_dead_tup", 0) - i_tup.get("n_dead_tup", 0)
        print(f"  - Table '{tbl}': +{live_delta} live rows, +{dead_delta} dead tuples")

    print("\nPURE ASGI SERVER LATENCY (STEADY STATE):")
    print(f"  - Total Requests Handled: {total_counters['total']:,}")
    print(f"  - p50: {asgi_pct['p50']} ms | p90: {asgi_pct['p90']} ms | p95: {asgi_pct['p95']} ms | p99: {asgi_pct['p99']} ms | Max: {asgi_pct['max']} ms")

    if history:
        print("\nTIME-WINDOWED CLIENT LATENCY (EVOLUTION OVER RUN):")
        # Sample every 30 seconds
        step = max(1, len(history) // 6)
        print(f"  {'Time (s)':<10} | {'RPS':<10} | {'Client p50':<12} | {'Client p95':<12} | {'Client p99':<12}")
        print(f"  {'-'*10}-|-{'-'*10}-|-{'-'*12}-|-{'-'*12}-|-{'-'*12}")
        for i in range(0, len(history), step):
            snap = history[i]
            print(f"  {i*10:<10} | {snap['rps']:<10.1f} | {snap['p50']:<12.1f} | {snap['p95']:<12.1f} | {snap['p99']:<12.1f}")

    print("=" * 70)


if __name__ == "__main__":
    asyncio.run(main())

