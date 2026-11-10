"""Concurrency test: simultaneous custom alias claims."""

import asyncio

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_concurrent_alias_claims_exactly_one_winner(
    test_client: AsyncClient,
) -> None:
    """Invariant: When N concurrent requests contend for the same alias,
    exactly one succeeds (201) and N-1 fail with 409 Conflict.
    """
    alias = "high-contention-alias"
    contenders = 50

    async def claim_alias(idx: int) -> int:
        res = await test_client.post(
            "/api/v1/urls",
            json={
                "url": f"https://example.com/contender/{idx}",
                "customAlias": alias,
            },
        )
        return res.status_code

    # Fire all contenders concurrently
    tasks = [claim_alias(i) for i in range(contenders)]
    results = await asyncio.gather(*tasks)

    success_count = results.count(201)
    conflict_count = results.count(409)

    assert success_count == 1, f"Expected exactly 1 success, got {success_count}"
    assert conflict_count == contenders - 1, (
        f"Expected {contenders - 1} conflicts, got {conflict_count}"
    )
