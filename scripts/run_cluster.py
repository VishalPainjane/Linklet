"""Multi-worker process cluster launcher for Linklet benchmarks on Windows/Linux."""

import os
import subprocess
import sys
import time
import urllib.request

PORTS = [8001, 8002, 8003, 8004]
WORKERS: list[subprocess.Popen] = []  # type: ignore[type-arg]


def stop_workers() -> None:
    print("\nShutting down cluster workers...")
    for p in WORKERS:
        if p.poll() is None:
            p.terminate()
    time.sleep(1)
    for p in WORKERS:
        if p.poll() is None:
            p.kill()
    print("All cluster workers stopped.")


def main() -> None:
    env = os.environ.copy()
    env["DATABASE_URL"] = env.get(
        "DATABASE_URL",
        "postgresql+asyncpg://linklet:local-only-change-me@localhost:5433/linklet",
    )
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    backend_dir = os.path.join(repo_root, "backend")

    # Use virtualenv python if available
    venv_python = os.path.join(backend_dir, ".venv", "Scripts", "python.exe")
    python_bin = venv_python if os.path.exists(venv_python) else sys.executable

    print(f"Starting Linklet 4-worker cluster across ports {PORTS} using {python_bin}...")
    for port in PORTS:
        cmd = [
            python_bin,
            "-m",
            "uvicorn",
            "linklet.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--log-level",
            "warning",
        ]
        proc = subprocess.Popen(cmd, cwd=backend_dir, env=env)
        WORKERS.append(proc)
        print(f"  Worker on port {port} started with PID {proc.pid}")

    print("Verifying cluster health...")
    healthy = set()
    deadline = time.time() + 15
    while time.time() < deadline and len(healthy) < len(PORTS):
        for port in PORTS:
            if port not in healthy:
                try:
                    resp = urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=1.0)
                    if resp.status == 200:
                        healthy.add(port)
                        print(f"  Worker on port {port} is HEALTHY")
                except Exception:
                    pass
        time.sleep(0.5)

    if len(healthy) == len(PORTS):
        print(f"All {len(PORTS)} worker nodes are online and ready for traffic!")
    else:
        print(f"Warning: Only {len(healthy)}/{len(PORTS)} workers became healthy.")

    try:
        while True:
            time.sleep(1)
            for p in WORKERS:
                if p.poll() is not None:
                    print(f"Worker PID {p.pid} terminated unexpectedly!")
                    stop_workers()
                    sys.exit(1)
    except KeyboardInterrupt:
        stop_workers()


if __name__ == "__main__":
    main()

