"""Locust load test suite for Linklet systems engineering benchmarks."""

import json
import os
import random
import urllib.request
from locust import HttpUser, between, events, task

SEED_CODE = os.environ.get("SHORT_CODE", "seedCode1")
ACTIVE_CODES: list[str] = [SEED_CODE]
TARGET_NODES: list[str] = [
    n.strip() for n in os.environ.get("LINKLET_TARGET_NODES", "").split(",") if n.strip()
]


@events.test_start.add_listener
def on_test_start(environment, **kwargs) -> None:  # type: ignore[no-untyped-def]
    """Pre-seed the initial short URL so redirect tests hit 302 Found immediately."""
    hosts = TARGET_NODES if TARGET_NODES else [environment.host or "http://localhost:8000"]
    payload = {
        "url": "https://example.com/systems-engineering-lab",
        "customAlias": SEED_CODE,
    }
    for host in hosts:
        try:
            req = urllib.request.Request(
                f"{host.rstrip('/')}/api/v1/urls",
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
            )
            urllib.request.urlopen(req, timeout=5.0)
        except Exception:
            # Link may already exist or will be generated on first create
            pass


class LinkletUser(HttpUser):
    """Models a representative mixed traffic workload (99% Redirect Read, 1% Create Write)."""

    wait_time = between(0.01, 0.05)

    @task(99)
    def redirect(self) -> None:
        """Simulates 99% read traffic hitting the short link redirect endpoint."""
        target_code = random.choice(ACTIVE_CODES)
        if TARGET_NODES:
            node = random.choice(TARGET_NODES)
            target_url = f"{node}/{target_code}"
        else:
            target_url = f"/{target_code}"
        with self.client.get(
            target_url,
            name="GET /{code}",
            allow_redirects=False,
            catch_response=True,
        ) as response:
            if response.status_code == 302:
                if response.headers.get("Location"):
                    response.success()
                else:
                    response.failure("Missing Location header in 302 redirect")
            elif response.status_code in (404, 410):
                response.success()
            else:
                response.failure(f"Unexpected redirect status: {response.status_code}")

    @task(1)
    def create(self) -> None:
        """Simulates 1% write traffic creating new shortened URLs."""
        random_suffix = random.randint(100000, 999999)
        payload = {"url": f"https://example.com/locust-test/{random_suffix}"}
        if TARGET_NODES:
            node = random.choice(TARGET_NODES)
            target_url = f"{node}/api/v1/urls"
        else:
            target_url = "/api/v1/urls"
        with self.client.post(
            target_url,
            json=payload,
            name="POST /api/v1/urls",
            catch_response=True,
        ) as response:
            if response.status_code == 201:
                data = response.json()
                code = data.get("code")
                if code and "short_url" in data:
                    ACTIVE_CODES.append(code)
                    if len(ACTIVE_CODES) > 500:
                        ACTIVE_CODES.pop(1)
                    response.success()
                else:
                    response.failure("Response missing code or short_url")
            elif response.status_code == 429:
                # Rate limited under burst
                response.success()
            else:
                response.failure(f"Creation failed with status: {response.status_code}")
