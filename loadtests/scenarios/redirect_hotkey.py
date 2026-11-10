"""Locust scenario: 100% Hot Key Redirect read workload."""

import os
from locust import HttpUser, between, task

HOT_KEY = os.environ.get("HOT_KEY_CODE", "popular01")


class HotKeyRedirectUser(HttpUser):
    """Stress tests cache hit ratio, memory concurrency, and single-flight coalescing."""

    wait_time = between(0.01, 0.05)

    @task
    def resolve_hot_link(self) -> None:
        with self.client.get(
            f"/{HOT_KEY}",
            name="GET /{hot_key}",
            allow_redirects=False,
            catch_response=True,
        ) as response:
            if response.status_code == 302 and response.headers.get("Location"):
                response.success()
            elif response.status_code == 404:
                response.success()
            else:
                response.failure(f"Unexpected status: {response.status_code}")
