"""Integration tests for URL CRUD endpoints."""

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from linklet.models.outbox import OutboxEvent


@pytest.mark.asyncio
async def test_create_generated_url(test_client: AsyncClient) -> None:
    res = await test_client.post(
        "/api/v1/urls",
        json={"url": "https://example.com/system-article"},
    )
    assert res.status_code == 201
    data = res.json()
    assert len(data["code"]) == 8
    assert data["destination_url"] == "https://example.com/system-article"
    assert data["short_url"].endswith(data["code"])


@pytest.mark.asyncio
async def test_create_custom_alias_and_conflict(test_client: AsyncClient) -> None:
    # First creation succeeds
    res1 = await test_client.post(
        "/api/v1/urls",
        json={"url": "https://example.com/docs", "customAlias": "my-docs"},
    )
    assert res1.status_code == 201
    assert res1.json()["code"] == "my-docs"

    # Second creation with identical alias returns 409 Conflict
    res2 = await test_client.post(
        "/api/v1/urls",
        json={"url": "https://example.com/different-docs", "customAlias": "my-docs"},
    )
    assert res2.status_code == 409
    assert "already in use" in res2.json()["message"]


@pytest.mark.asyncio
async def test_idempotency_replay_and_conflict(test_client: AsyncClient) -> None:
    headers = {"Idempotency-Key": "idemp-req-001"}
    payload = {"url": "https://example.com/idempotent"}

    # First attempt: creates URL
    res1 = await test_client.post("/api/v1/urls", json=payload, headers=headers)
    assert res1.status_code == 201
    code1 = res1.json()["code"]

    # Replayed identical attempt: returns cached response
    res2 = await test_client.post("/api/v1/urls", json=payload, headers=headers)
    assert res2.status_code == 200 or res2.status_code == 201
    assert res2.json()["code"] == code1

    # Conflict attempt: same idempotency key with different payload returns 409
    different_payload = {"url": "https://example.com/completely-different"}
    res3 = await test_client.post("/api/v1/urls", json=different_payload, headers=headers)
    assert res3.status_code == 409
    assert "different request payload" in res3.json()["message"]


@pytest.mark.asyncio
async def test_get_metadata_and_stats(test_client: AsyncClient) -> None:
    res_create = await test_client.post(
        "/api/v1/urls",
        json={"url": "https://example.com/metrics", "customAlias": "metrics-link"},
    )
    assert res_create.status_code == 201

    # Fetch metadata
    meta = await test_client.get("/api/v1/urls/metrics-link")
    assert meta.status_code == 200
    meta_data = meta.json()
    assert meta_data["code"] == "metrics-link"
    assert meta_data["is_active"] is True

    # Fetch initial stats
    stats = await test_client.get("/api/v1/urls/metrics-link/stats")
    assert stats.status_code == 200
    stats_data = stats.json()
    assert stats_data["code"] == "metrics-link"
    assert stats_data["click_count"] == 0


@pytest.mark.asyncio
async def test_disable_url(
    test_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    res_create = await test_client.post(
        "/api/v1/urls",
        json={"url": "https://example.com/temp", "customAlias": "to-disable"},
    )
    assert res_create.status_code == 201

    # Disable
    res_del = await test_client.delete("/api/v1/urls/to-disable")
    assert res_del.status_code == 204

    # Metadata now reports is_active=False
    meta = await test_client.get("/api/v1/urls/to-disable")
    assert meta.status_code == 200
    assert meta.json()["is_active"] is False

    # Verify transactional outbox event was atomically inserted
    async with session_factory() as session:
        outbox_res = await session.execute(
            select(OutboxEvent).where(OutboxEvent.aggregate_id == "to-disable")
        )
        event = outbox_res.scalar_one_or_none()
        assert event is not None
        assert event.event_type == "URL_DELETED"
        assert event.payload["code"] == "to-disable"

