"""Progressive benchmark runner for Investigation 6 using FastHttpUser."""

import csv
import json
import os
import subprocess
import sys
import time
import psutil

STAGES = [
    {"users": 100, "rate": 50, "duration": "20s"},
    {"users": 250, "rate": 50, "duration": "20s"},
    {"users": 500, "rate": 100, "duration": "25s"},
    {"users": 750, "rate": 150, "duration": "25s"},
    {"users": 1000, "rate": 200, "duration": "25s"},
]

PORTS = [8001, 8002, 8003, 8004]


def find_worker_pids() -> dict[int, list[int]]:
    worker_pids: dict[int, list[int]] = {p: [] for p in PORTS}
    for proc in psutil.process_iter(["pid", "cmdline"]):
        try:
            cmd = proc.info.get("cmdline") or []
            for port in PORTS:
                if str(port) in cmd and "linklet.main:app" in cmd:
                    worker_pids[port].append(proc.pid)
        except Exception:
            pass
    return worker_pids


def run_stage(stage: dict) -> dict:
    users = stage["users"]
    rate = stage["rate"]
    duration = stage["duration"]
    csv_prefix = f"results/fasthttp_stage_{users}"
    log_path = f"results/fasthttp_stage_{users}.log"

    print(f"\n=======================================================", flush=True)
    print(f"  STARTING STAGE: {users} Users (Spawn rate: {rate}/s, Duration: {duration})", flush=True)
    print(f"=======================================================", flush=True)

    worker_pids = find_worker_pids()
    worker_procs: dict[int, list[psutil.Process]] = {}
    for port, pids in worker_pids.items():
        worker_procs[port] = []
        for pid in pids:
            try:
                p = psutil.Process(pid)
                p.cpu_percent(interval=None)
                worker_procs[port].append(p)
            except Exception:
                pass

    env = os.environ.copy()
    env["LINKLET_TARGET_NODES"] = (
        "http://127.0.0.1:8001,http://127.0.0.1:8002,http://127.0.0.1:8003,http://127.0.0.1:8004"
    )

    cmd = [
        sys.executable,
        "-m",
        "uv",
        "run",
        "--project",
        "backend",
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

        # Wrap psutil Process for locust
        locust_p = psutil.Process(locust_proc.pid)
        locust_p.cpu_percent(interval=None)
        psutil.cpu_percent(interval=None)

        locust_cpu_samples: list[float] = []
        worker_cpu_samples: dict[int, list[float]] = {p: [] for p in PORTS}
        system_cpu_samples: list[float] = []

        # Monitor CPU while locust is running
        while locust_proc.poll() is None:
            time.sleep(1.0)
            system_cpu_samples.append(psutil.cpu_percent(interval=None))
            try:
                # Locust plus its children
                total_locust_cpu = locust_p.cpu_percent(interval=None)
                for child in locust_p.children(recursive=True):
                    try:
                        total_locust_cpu += child.cpu_percent(interval=None)
                    except Exception:
                        pass
                locust_cpu_samples.append(total_locust_cpu)
            except Exception:
                pass

            for port, p_list in worker_procs.items():
                total_w_cpu = 0.0
                for p in p_list:
                    try:
                        if p.is_running():
                            total_w_cpu += p.cpu_percent(interval=None)
                    except Exception:
                        pass
                worker_cpu_samples[port].append(total_w_cpu)

    # Read log content
    has_cpu_warning = False
    if os.path.exists(log_path):
        with open(log_path, "r", encoding="utf-8", errors="replace") as f:
            log_content = f.read()
            has_cpu_warning = "CPU usage was too high" in log_content

    # Read CSV stats
    stats_file = f"{csv_prefix}_stats.csv"
    get_stats = {}
    agg_stats = {}
    if os.path.exists(stats_file):
        with open(stats_file, mode="r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                if row.get("Name") == "GET /{code}":
                    get_stats = row
                elif row.get("Name") == "Aggregated":
                    agg_stats = row

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
        "get_stats": {
            "requests": int(get_stats.get("Request Count", 0)),
            "failures": int(get_stats.get("Failure Count", 0)),
            "rps": float(get_stats.get("Requests/s", 0.0)),
            "p50": float(get_stats.get("50%", 0.0)),
            "p95": float(get_stats.get("95%", 0.0)),
            "p98": float(get_stats.get("98%", 0.0)),
            "p99": float(get_stats.get("99%", 0.0)),
            "max": float(get_stats.get("Max Response Time", 0.0)),
        },
        "agg_stats": {
            "requests": int(agg_stats.get("Request Count", 0)),
            "failures": int(agg_stats.get("Failure Count", 0)),
            "rps": float(agg_stats.get("Requests/s", 0.0)),
            "p50": float(agg_stats.get("50%", 0.0)),
            "p95": float(agg_stats.get("95%", 0.0)),
            "p99": float(agg_stats.get("99%", 0.0)),
        },
    }

    print(f"  Stage {users} Complete:", flush=True)
    print(f"    Locust CPU: avg={locust_cpu_avg}%, max={locust_cpu_max}%, p95={locust_cpu_p95}% | Warning: {has_cpu_warning}", flush=True)
    print(f"    GET RPS: {stage_result['get_stats']['rps']} | Total GETs: {stage_result['get_stats']['requests']} | Failures: {stage_result['get_stats']['failures']}", flush=True)
    print(f"    GET Latency: p50={stage_result['get_stats']['p50']}ms, p95={stage_result['get_stats']['p95']}ms, p98={stage_result['get_stats']['p98']}ms, p99={stage_result['get_stats']['p99']}ms, max={stage_result['get_stats']['max']}ms", flush=True)

    time.sleep(2)  # Cooldown between stages
    return stage_result


def main() -> None:
    all_results = []
    for stage in STAGES:
        res = run_stage(stage)
        all_results.append(res)

    output_path = "results/investigation6_fasthttp_progressive.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(all_results, f, indent=2)

    print("\n================== ALL STAGES COMPLETE ==================", flush=True)
    print(json.dumps(all_results, indent=2), flush=True)


if __name__ == "__main__":
    main()
