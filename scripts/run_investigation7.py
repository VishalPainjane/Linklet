"""Investigation 7 benchmark runner: Stage-specific pure-ASGI histograms vs Locust client latency."""

import csv
import json
import os
import subprocess
import sys
import time
import urllib.request
import psutil

STAGES = [
    {"users": 100, "rate": 50, "duration": "20s"},
    {"users": 250, "rate": 50, "duration": "20s"},
    {"users": 500, "rate": 100, "duration": "25s"},
    {"users": 750, "rate": 150, "duration": "25s"},
    {"users": 1000, "rate": 200, "duration": "25s"},
]

PORTS = [8001, 8002, 8003, 8004]


def reset_worker_asgi_counters() -> None:
    for port in PORTS:
        try:
            req = urllib.request.Request(f"http://127.0.0.1:{port}/diagnostics/asgi?reset=true")
            urllib.request.urlopen(req, timeout=2.0)
        except Exception as exc:
            print(f"Warning: Failed to reset worker on port {port}: {exc}", flush=True)


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
            resp = urllib.request.urlopen(f"http://127.0.0.1:{port}/diagnostics/asgi", timeout=2.0)
            data = json.loads(resp.read().decode())
            worker_details[port] = data
            for k in total_counters.keys():
                total_counters[k] += data["counters"].get(k, 0)
            all_samples.extend(data.get("samples", []))
        except Exception as exc:
            print(f"Warning: Failed to fetch ASGI stats from port {port}: {exc}", flush=True)

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


def run_stage(stage: dict) -> dict:
    users = stage["users"]
    rate = stage["rate"]
    duration = stage["duration"]
    csv_prefix = f"results/inv7_stage_{users}"
    log_path = f"results/inv7_stage_{users}.log"
    os.makedirs("results", exist_ok=True)

    print(f"\n=======================================================", flush=True)
    print(f"  STARTING STAGE: {users} Users (Spawn rate: {rate}/s, Duration: {duration})", flush=True)
    print(f"=======================================================", flush=True)

    # 1. Reset server-side ASGI counters on all 4 workers
    reset_worker_asgi_counters()
    time.sleep(0.5)

    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    venv_python = os.path.join(repo_root, "backend", ".venv", "Scripts", "python.exe")

    env = os.environ.copy()
    env["LINKLET_TARGET_NODES"] = (
        "http://127.0.0.1:8001,http://127.0.0.1:8002,http://127.0.0.1:8003,http://127.0.0.1:8004"
    )

    cmd = [
        venv_python,
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
        str(rate),
        "--run-time",
        duration,
        "--csv",
        csv_prefix,
    ]

    with open(log_path, "w", encoding="utf-8") as stage_log:
        locust_proc = subprocess.Popen(
            cmd,
            stdout=stage_log,
            stderr=subprocess.STDOUT,
            env=env,
        )

        locust_p = psutil.Process(locust_proc.pid)
        print(f"  Monitored Locust Process: PID {locust_p.pid} ({locust_p.name()}) - Cmd: {' '.join(locust_p.cmdline()[:3])}", flush=True)

        locust_cpu_samples: list[float] = []
        last_time = time.time()
        try:
            last_c = locust_p.cpu_times()
        except Exception:
            last_c = None

        # Monitor CPU every second
        while locust_proc.poll() is None:
            time.sleep(1.0)
            now = time.time()
            dt = now - last_time
            last_time = now
            if last_c and dt > 0:
                try:
                    c = locust_p.cpu_times()
                    used = (c.user - last_c.user) + (c.system - last_c.system)
                    for child in locust_p.children(recursive=True):
                        try:
                            cc = child.cpu_times()
                            used += cc.user + cc.system
                        except Exception:
                            pass
                    cpu_pct = round((used / dt) * 100, 1)
                    locust_cpu_samples.append(cpu_pct)
                    last_c = c
                except Exception:
                    pass

    # 2. Immediately collect post-stage ASGI statistics
    total_counters, all_samples, worker_details = fetch_worker_asgi_stats()
    asgi_pct = compute_percentiles(all_samples)

    # 3. Read Locust output log for warnings
    has_cpu_warning = False
    if os.path.exists(log_path):
        with open(log_path, "r", encoding="utf-8", errors="replace") as f:
            log_content = f.read()
            has_cpu_warning = "CPU usage was too high" in log_content

    # 4. Read Locust CSV
    stats_file = f"{csv_prefix}_stats.csv"
    get_stats = {}
    if os.path.exists(stats_file):
        with open(stats_file, mode="r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                if row.get("Name") == "GET /{code}":
                    get_stats = row
                    break

    locust_p50 = float(get_stats.get("50%", 0.0))
    locust_p90 = float(get_stats.get("90%", 0.0))
    locust_p95 = float(get_stats.get("95%", 0.0))
    locust_p99 = float(get_stats.get("99%", 0.0))
    locust_max = float(get_stats.get("Max Response Time", 0.0))
    rps = float(get_stats.get("Requests/s", 0.0))
    req_count = int(get_stats.get("Request Count", 0))
    fails = int(get_stats.get("Failure Count", 0))

    locust_cpu_avg = (
        round(sum(locust_cpu_samples) / len(locust_cpu_samples), 1)
        if locust_cpu_samples
        else 0.0
    )
    locust_cpu_max = round(max(locust_cpu_samples), 1) if locust_cpu_samples else 0.0
    locust_cpu_p95 = (
        round(sorted(locust_cpu_samples)[int(len(locust_cpu_samples) * 0.95)], 1)
        if locust_cpu_samples
        else 0.0
    )

    stage_result = {
        "users": users,
        "locust_cpu": {
            "avg": locust_cpu_avg,
            "max": locust_cpu_max,
            "p95": locust_cpu_p95,
            "warning": has_cpu_warning,
        },
        "comparison": {
            "p50": {"locust": locust_p50, "asgi": asgi_pct["p50"]},
            "p90": {"locust": locust_p90, "asgi": asgi_pct["p90"]},
            "p95": {"locust": locust_p95, "asgi": asgi_pct["p95"]},
            "p99": {"locust": locust_p99, "asgi": asgi_pct["p99"]},
            "max": {"locust": locust_max, "asgi": asgi_pct["max"]},
        },
        "asgi_histogram": total_counters,
        "locust_summary": {
            "requests": req_count,
            "failures": fails,
            "rps": rps,
        },
        "worker_details": {
            port: data["counters"] for port, data in worker_details.items()
        },
    }

    print(f"\n  --- Stage {users} Results ---", flush=True)
    print(f"  Locust CPU: avg={locust_cpu_avg}%, max={locust_cpu_max}%, p95={locust_cpu_p95}% | Warning: {has_cpu_warning}", flush=True)
    print(f"  Throughput: {rps} req/s | Total GETs: {req_count} | Failures: {fails}", flush=True)
    print("  Latency Comparison for GET /{code}:", flush=True)
    print("    Metric | Locust (Client) | ASGI (Server)", flush=True)
    print("    -------|-----------------|--------------", flush=True)
    print(f"    p50    | {locust_p50:9.1f} ms    | {asgi_pct['p50']:8.2f} ms", flush=True)
    print(f"    p90    | {locust_p90:9.1f} ms    | {asgi_pct['p90']:8.2f} ms", flush=True)
    print(f"    p95    | {locust_p95:9.1f} ms    | {asgi_pct['p95']:8.2f} ms", flush=True)
    print(f"    p99    | {locust_p99:9.1f} ms    | {asgi_pct['p99']:8.2f} ms", flush=True)
    print(f"    Max    | {locust_max:9.1f} ms    | {asgi_pct['max']:8.2f} ms", flush=True)
    print("  ASGI Histogram Counters:", flush=True)
    print(f"    {json.dumps(total_counters)}", flush=True)

    time.sleep(2)  # Cooldown
    return stage_result


def main() -> None:
    all_results = []
    for stage in STAGES:
        res = run_stage(stage)
        all_results.append(res)

    out_path = "results/investigation7_report.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(all_results, f, indent=2)

    print("\n================== INVESTIGATION 7 COMPLETE ==================", flush=True)


if __name__ == "__main__":
    main()
