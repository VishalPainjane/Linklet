"""Controlled 500-User, 30-Second Benchmark: FastHttpUser with allow_redirects=False.

Validates whether benchmark contamination (redirect following or client connection pool)
caused the previously observed tail latency discrepancy.
"""

import csv
import json
import os
import subprocess
import sys
import time
import urllib.request
import psutil

PORTS = [8001, 8002, 8003, 8004]
USERS = 500
SPAWN_RATE = 100
DURATION = "30s"
CSV_PREFIX = "results/controlled_500"
LOG_PATH = "results/controlled_500.log"


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


def fetch_worker_asgi_stats() -> tuple[dict[str, int], list[float], dict[int, dict]]:
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
    worker_details: dict[int, dict] = {}

    for port in PORTS:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/diagnostics/asgi", timeout=3.0) as resp:
                data = json.loads(resp.read().decode())
                worker_details[port] = data
                for k in total_counters.keys():
                    total_counters[k] += data.get("counters", {}).get(k, 0)
                all_samples.extend(data.get("samples", []))
        except Exception as exc:
            print(f"  Warning: Worker {port} fetch failed: {exc}")

    return total_counters, all_samples, worker_details


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


def parse_locust_csv(prefix: str) -> dict:
    stats_file = f"{prefix}_stats.csv"
    results = {}
    if os.path.exists(stats_file):
        with open(stats_file, mode="r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                name = row.get("Name", "")
                if name == "Aggregated" or name == "GET /{code}":
                    results[name] = {
                        "requests": int(row.get("Request Count", 0)),
                        "failures": int(row.get("Failure Count", 0)),
                        "median": float(row.get("50%", 0) or 0),
                        "p90": float(row.get("90%", 0) or 0),
                        "p95": float(row.get("95%", 0) or 0),
                        "p99": float(row.get("99%", 0) or 0),
                        "max": float(row.get("Max Response Time", 0) or 0),
                        "rps": float(row.get("Requests/s", 0) or 0),
                    }
    return results


def parse_locust_failures(prefix: str) -> list[dict]:
    fail_file = f"{prefix}_failures.csv"
    failures = []
    if os.path.exists(fail_file):
        with open(fail_file, mode="r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                failures.append(dict(row))
    return failures


def main() -> None:
    os.makedirs("results", exist_ok=True)
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    backend_dir = os.path.join(repo_root, "backend")
    venv_python = os.path.join(backend_dir, ".venv", "Scripts", "python.exe")
    python_bin = venv_python if os.path.exists(venv_python) else sys.executable

    print("=================================================================")
    print("  CONTROLLED BENCHMARK: 500 USERS | 30 SECONDS | allow_redirects=False")
    print("=================================================================")

    # 1. Reset ASGI counters
    reset_worker_asgi_counters()
    time.sleep(1.0)

    # 2. Prepare Locust execution
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
        str(USERS),
        "-r",
        str(SPAWN_RATE),
        "--run-time",
        DURATION,
        "--csv",
        CSV_PREFIX,
    ]

    print(f"\nLaunching Locust runner ({USERS} users, {SPAWN_RATE}/s ramp, {DURATION} duration)...")
    with open(LOG_PATH, "w", encoding="utf-8") as log_file:
        locust_proc = subprocess.Popen(
            cmd,
            stdout=log_file,
            stderr=subprocess.STDOUT,
            env=env,
        )

        p = psutil.Process(locust_proc.pid)
        print(f"Locust runner started with PID {p.pid}.")

        # Initial call to cpu_percent to set baseline
        p.cpu_percent(interval=None)
        cpu_measurements: list[float] = []
        system_cpu_measurements: list[float] = []

        start_time = time.time()
        while locust_proc.poll() is None:
            time.sleep(1.0)
            try:
                proc_cpu = p.cpu_percent(interval=None)
                sys_cpu = psutil.cpu_percent(interval=None)
                cpu_measurements.append(proc_cpu)
                system_cpu_measurements.append(sys_cpu)
                elapsed = int(time.time() - start_time)
                print(
                    f"  [{elapsed:02d}s] Locust Proc CPU: {proc_cpu:5.1f}% | Total Host CPU: {sys_cpu:5.1f}%",
                    flush=True,
                )
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                break

    print("\nLocust process finished. Gathering metrics...")

    # 3. Post-stage ASGI metric collection
    total_counters, all_samples, worker_details = fetch_worker_asgi_stats()
    asgi_pct = compute_percentiles(all_samples)

    # 4. Parse Locust CSV metrics
    locust_stats = parse_locust_csv(CSV_PREFIX)
    locust_failures = parse_locust_failures(CSV_PREFIX)

    # Check for CPU warning in log
    cpu_warning_found = False
    with open(LOG_PATH, "r", encoding="utf-8") as f:
        log_content = f.read()
        if "CPU usage was too high" in log_content:
            cpu_warning_found = True

    # 5. Output Results Report
    print("\n" + "=" * 70)
    print("                    EXPERIMENTAL RESULTS REPORT")
    print("=" * 70)

    redirect_locust = locust_stats.get("GET /{code}", {})
    total_locust = locust_stats.get("Aggregated", {})

    print(f"\n1. THROUGHPUT & RELIABILITY:")
    print(f"  - Target Nodes: 4 workers (8001, 8002, 8003, 8004)")
    print(f"  - Total Locust Requests: {total_locust.get('requests', 0):,}")
    print(f"  - Locust Achieved RPS:   {total_locust.get('rps', 0):.1f} req/s")
    print(f"  - Total Locust Failures: {total_locust.get('failures', 0)}")
    print(f"  - Failure Messages:")
    if locust_failures:
        for f in locust_failures:
            print(f"      * {f.get('Method')} {f.get('Name')}: {f.get('Error')} ({f.get('Occurrences')} times)")
    else:
        print("      * None (0 failures)")

    print(f"\n2. LATENCY COMPARISON (GET /{{code}}):")
    print(f"  {'Metric':<10} | {'Locust Client (ms)':<20} | {'Pure ASGI Server (ms)':<22} | {'Difference (ms)':<15}")
    print(f"  {'-'*10}-|-{'-'*20}-|-{'-'*22}-|-{'-'*15}")
    print(f"  {'p50':<10} | {redirect_locust.get('median', 0):<20.2f} | {asgi_pct.get('p50', 0):<22.2f} | {redirect_locust.get('median', 0) - asgi_pct.get('p50', 0):<15.2f}")
    print(f"  {'p90':<10} | {redirect_locust.get('p90', 0):<20.2f} | {asgi_pct.get('p90', 0):<22.2f} | {redirect_locust.get('p90', 0) - asgi_pct.get('p90', 0):<15.2f}")
    print(f"  {'p95':<10} | {redirect_locust.get('p95', 0):<20.2f} | {asgi_pct.get('p95', 0):<22.2f} | {redirect_locust.get('p95', 0) - asgi_pct.get('p95', 0):<15.2f}")
    print(f"  {'p99':<10} | {redirect_locust.get('p99', 0):<20.2f} | {asgi_pct.get('p99', 0):<22.2f} | {redirect_locust.get('p99', 0) - asgi_pct.get('p99', 0):<15.2f}")
    print(f"  {'Max':<10} | {redirect_locust.get('max', 0):<20.2f} | {asgi_pct.get('max', 0):<22.2f} | {redirect_locust.get('max', 0) - asgi_pct.get('max', 0):<15.2f}")

    print(f"\n3. PURE ASGI LATENCY HISTOGRAM ({total_counters['total']:,} total server requests):")
    tot = total_counters["total"] if total_counters["total"] > 0 else 1
    print(f"  - <= 10 ms:   {total_counters['le_10']:6d}  ({total_counters['le_10']/tot*100:5.1f}%)")
    print(f"  - <= 25 ms:   {total_counters['le_25']:6d}  ({total_counters['le_25']/tot*100:5.1f}%)")
    print(f"  - <= 50 ms:   {total_counters['le_50']:6d}  ({total_counters['le_50']/tot*100:5.1f}%)")
    print(f"  - <= 100 ms:  {total_counters['le_100']:6d}  ({total_counters['le_100']/tot*100:5.1f}%)")
    print(f"  - <= 250 ms:  {total_counters['le_250']:6d}  ({total_counters['le_250']/tot*100:5.1f}%)")
    print(f"  - <= 500 ms:  {total_counters['le_500']:6d}  ({total_counters['le_500']/tot*100:5.1f}%)")
    print(f"  - <= 1000 ms: {total_counters['le_1000']:6d}  ({total_counters['le_1000']/tot*100:5.1f}%)")
    print(f"  - > 1000 ms:  {total_counters['gt_1000']:6d}  ({total_counters['gt_1000']/tot*100:5.1f}%)")

    print(f"\n4. PER-WORKER REQUEST DISTRIBUTION:")
    for port, det in worker_details.items():
        w_cnt = det.get("counters", {}).get("total", 0)
        w_pct = det.get("percentiles", {})
        print(f"  - Worker {port} (PID {det.get('pid')}): {w_cnt} reqs | p50={w_pct.get('p50')}ms p95={w_pct.get('p95')}ms p99={w_pct.get('p99')}ms max={w_pct.get('max')}ms")

    print(f"\n5. CPU & RESOURCE METRICS:")
    avg_proc_cpu = sum(cpu_measurements) / len(cpu_measurements) if cpu_measurements else 0
    max_proc_cpu = max(cpu_measurements) if cpu_measurements else 0
    avg_sys_cpu = sum(system_cpu_measurements) / len(system_cpu_measurements) if system_cpu_measurements else 0
    max_sys_cpu = max(system_cpu_measurements) if system_cpu_measurements else 0
    print(f"  - Locust Runner Process CPU (psutil): Avg = {avg_proc_cpu:.1f}%, Peak = {max_proc_cpu:.1f}%")
    print(f"  - Host Overall CPU:                   Avg = {avg_sys_cpu:.1f}%, Peak = {max_sys_cpu:.1f}%")
    print(f"  - Locust 'CPU usage was too high' Warning Emitted: {'YES' if cpu_warning_found else 'NO'}")
    print("=" * 70)


if __name__ == "__main__":
    main()

