"""Concurrency test: simultaneous requests with the same Idempotency-Key."""

import asyncio

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_concurrent_idempotency_requests_yield_identical_code(
    test_client: AsyncClient,
) -> None:
    """Invariant: When N concurrent requests submit the same idempotency key
    and identical payload, all requests return the same canonical code.
    """
    idemp_key = "concurrent-idemp-key-xyz"
    payload = {"url": "https://example.com/concurrent-idempotent-target"}
    headers = {"Idempotency-Key": idemp_key}
    request_count = 50

    async def send_req() -> tuple[int, str]:
        res = await test_client.post("/api/v1/urls", json=payload, headers=headers)
        data = res.json()
        return res.status_code, data.get("code", "")

    tasks = [send_req() for _ in range(request_count)]
    responses = await asyncio.gather(*tasks)

    # All should return 200 or 201
    statuses = [s for s, _ in responses]
    codes = [c for _, c in responses]

    for s in statuses:
        assert s in (200, 201)

    # All returned codes must be identical and non-empty
    unique_codes = set(codes)
    assert len(unique_codes) == 1
    assert "" not in unique_codes
