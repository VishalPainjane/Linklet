"""Locust load test suite for Linklet systems engineering benchmarks."""

import os
import random
from locust import HttpUser, between, task

SEED_CODE = os.environ.get("SHORT_CODE", "seedCode1")


class LinkletUser(HttpUser):
    """Models a representative mixed traffic workload (99% Redirect Read, 1% Create Write)."""

    wait_time = between(0.05, 0.2)

    def on_start(self) -> None:
        """Seed a short URL for this virtual user session if needed."""
        self.code = SEED_CODE

    @task(99)
    def redirect(self) -> None:
        """Simulates 99% read traffic hitting the short link redirect endpoint."""
        with self.client.get(
            f"/{self.code}",
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
                # Valid HTTP responses for non-existent/expired codes
                response.success()
            else:
                response.failure(f"Unexpected status code: {response.status_code}")

    @task(1)
    def create(self) -> None:
        """Simulates 1% write traffic creating new shortened URLs."""
        random_suffix = random.randint(100000, 999999)
        payload = {"url": f"https://example.com/locust-test/{random_suffix}"}
        with self.client.post(
            "/api/v1/urls",
            json=payload,
            name="POST /api/v1/urls",
            catch_response=True,
        ) as response:
            if response.status_code == 201:
                data = response.json()
                if "code" in data and "short_url" in data:
                    response.success()
                else:
                    response.failure("Response missing code or short_url")
            elif response.status_code == 429:
                # Rate limit encountered
                response.success()
            else:
                response.failure(f"Creation failed with status: {response.status_code}")
