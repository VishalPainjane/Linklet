"""Integration tests for health and readiness probes."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_health_probe(test_client: AsyncClient) -> None:
    res = await test_client.get("/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert data["service"] == "linklet"


@pytest.mark.asyncio
async def test_readiness_probe(test_client: AsyncClient) -> None:
    res = await test_client.get("/ready")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ready"
    assert data["dependencies"]["postgres"] == "healthy"

