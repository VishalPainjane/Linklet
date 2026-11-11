"""CPU utilization monitor for Linklet cluster workers and Locust generator during benchmarks."""

import argparse
import json
import os
import time
import psutil

PORTS = [8001, 8002, 8003, 8004]


def find_worker_pids() -> dict[int, list[int]]:
    worker_pids: dict[int, list[int]] = {p: [] for p in PORTS}
    for proc in psutil.process_iter(["pid", "ppid", "cmdline"]):
        try:
            cmd = proc.info.get("cmdline") or []
            for port in PORTS:
                if str(port) in cmd and "linklet.main:app" in cmd:
                    worker_pids[port].append(proc.pid)
        except Exception:
            pass
    return worker_pids


def find_locust_procs() -> list[psutil.Process]:
    locust_procs: list[psutil.Process] = []
    for proc in psutil.process_iter(["pid", "cmdline"]):
        try:
            cmd = proc.info.get("cmdline") or []
            if any("locust" in str(c).lower() for c in cmd) and proc.pid != os.getpid():
                locust_procs.append(proc)
        except Exception:
            pass
    return locust_procs


def monitor(duration_seconds: int, output_file: str) -> None:
    worker_pids = find_worker_pids()
    print("Found worker PIDs:")
    for port, pids in worker_pids.items():
        print(f"  Port {port}: {pids}")

    # Initialize psutil Process objects for workers
    procs: dict[int, list[psutil.Process]] = {}
    for port, pids in worker_pids.items():
        procs[port] = []
        for pid in pids:
            try:
                p = psutil.Process(pid)
                p.cpu_percent(interval=None)  # prime cpu_percent
                procs[port].append(p)
            except Exception:
                pass

    locust_procs: list[psutil.Process] = []
    for lp in find_locust_procs():
        try:
            lp.cpu_percent(interval=None)
            locust_procs.append(lp)
        except Exception:
            pass

    psutil.cpu_percent(interval=None)  # prime system cpu

    samples: list[dict[str, float]] = []
    end_time = time.time() + duration_seconds

    print(f"Sampling CPU utilization every 1.0s for {duration_seconds}s...")
    while time.time() < end_time:
        time.sleep(1.0)
        sys_cpu = psutil.cpu_percent(interval=None)
        sample: dict[str, float] = {"time": time.time(), "system_cpu_percent": sys_cpu}

        # Check for newly spawned locust process if not yet found
        if not locust_procs:
            for lp in find_locust_procs():
                try:
                    lp.cpu_percent(interval=None)
                    locust_procs.append(lp)
                except Exception:
                    pass

        locust_cpu = 0.0
        for lp in list(locust_procs):
            try:
                if lp.is_running():
                    locust_cpu += lp.cpu_percent(interval=None)
            except Exception:
                pass
        sample["locust_cpu_percent"] = locust_cpu

        for port, p_list in procs.items():
            total_cpu = 0.0
            for p in p_list:
                try:
                    if p.is_running():
                        total_cpu += p.cpu_percent(interval=None)
                except Exception:
                    pass
            sample[f"worker_{port}_cpu_percent"] = total_cpu

        samples.append(sample)

    if not samples:
        return

    # Compute summary stats
    summary: dict[str, dict[str, float]] = {}
    for key in samples[0].keys():
        if key == "time":
            continue
        vals = [s[key] for s in samples]
        vals.sort()
        summary[key] = {
            "min": round(min(vals), 2),
            "max": round(max(vals), 2),
            "avg": round(sum(vals) / len(vals), 2),
            "p50": round(vals[len(vals) // 2], 2),
            "p95": round(vals[int(len(vals) * 0.95)], 2),
        }

    out_data = {
        "duration_seconds": duration_seconds,
        "sample_count": len(samples),
        "summary": summary,
        "samples": samples,
    }

    os.makedirs(os.path.dirname(os.path.abspath(output_file)), exist_ok=True)
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(out_data, f, indent=2)

    print("\n--- CPU Utilization Summary ---")
    for k, v in summary.items():
        print(f"  {k}: avg={v['avg']}%, max={v['max']}%, p95={v['p95']}%")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--duration", type=int, default=30)
    parser.add_argument("--output", type=str, default="results/investigation5_cpu.json")
    args = parser.parse_args()
    monitor(args.duration, args.output)
