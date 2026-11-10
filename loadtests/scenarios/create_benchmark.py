"""Locust scenario: 100% URL creation write-throughput benchmark."""

import random
from locust import HttpUser, between, task


class CreateOnlyUser(HttpUser):
    """Stress tests database write connection pool, Base62 generation, and transaction commits."""

    wait_time = between(0.05, 0.1)

    @task
    def create_unique_url(self) -> None:
        target_id = random.randint(1_000_000, 99_999_999)
        payload = {"url": f"https://example.com/benchmark/{target_id}"}
        with self.client.post(
            "/api/v1/urls",
            json=payload,
            name="POST /api/v1/urls",
            catch_response=True,
        ) as response:
            if response.status_code == 201:
                response.success()
            elif response.status_code == 429:
                response.success()
            else:
                response.failure(f"Status {response.status_code}")

