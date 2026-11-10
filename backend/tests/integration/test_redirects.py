"""Integration tests for HTTP redirect resolution, cache-aside behavior, and click dispatch."""

from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient

from linklet.messaging.publisher import MockEventPublisher


@pytest.mark.asyncio
async def test_redirect_active_url(
    test_client: AsyncClient,
    test_publisher: MockEventPublisher,
) -> None:
    # Create URL
    res = await test_client.post(
        "/api/v1/urls",
        json={"url": "https://example.com/target-dest", "customAlias": "redir-test"},
    )
    assert res.status_code == 201

    # Perform redirect (follow_redirects=False to inspect 302 and headers)
    redir_res = await test_client.get(
        "/redir-test",
        headers={
            "Referer": "https://news.ycombinator.com/",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            "CF-IPCountry": "US",
        },
    )
    assert redir_res.status_code == 302
    assert redir_res.headers["Location"] == "https://example.com/target-dest"
    assert "no-store" in redir_res.headers["Cache-Control"]

    # Verify event was enqueued to publisher
    assert len(test_publisher.published_events) == 1
    event = test_publisher.published_events[0]
    assert event.code == "redir-test"
    assert event.referrer_host == "news.ycombinator.com"
    assert event.country_code == "US"


@pytest.mark.asyncio
async def test_head_redirect_does_not_emit_click(
    test_client: AsyncClient,
    test_publisher: MockEventPublisher,
) -> None:
    await test_client.post(
        "/api/v1/urls",
        json={"url": "https://example.com/head-target", "customAlias": "head-test"},
    )
    test_publisher.published_events.clear()

    # HEAD request
    head_res = await test_client.head("/head-test")
    assert head_res.status_code == 302
    assert head_res.headers["Location"] == "https://example.com/head-target"
    assert not head_res.content  # HEAD body must be empty

    # HEAD should not increment analytics
    assert len(test_publisher.published_events) == 0


@pytest.mark.asyncio
async def test_redirect_unknown_code_returns_404(test_client: AsyncClient) -> None:
    res = await test_client.get("/nonexistent-code")
    assert res.status_code == 404
    assert "not found" in res.json()["message"].lower()


@pytest.mark.asyncio
async def test_redirect_disabled_code_returns_410(test_client: AsyncClient) -> None:
    await test_client.post(
        "/api/v1/urls",
        json={"url": "https://example.com/to-disable-target", "customAlias": "disabled-link"},
    )
    # Disable
    await test_client.delete("/api/v1/urls/disabled-link")

    # Redirect attempt returns 410 Gone
    res = await test_client.get("/disabled-link")
    assert res.status_code == 410
    assert "disabled" in res.json()["message"]


@pytest.mark.asyncio
async def test_redirect_expired_code_returns_410(test_client: AsyncClient) -> None:
    # Create with near-immediate expiration
    exp = datetime.now(UTC) + timedelta(milliseconds=50)
    await test_client.post(
        "/api/v1/urls",
        json={
            "url": "https://example.com/expired-target",
            "customAlias": "exp-link",
            "expiresAt": exp.isoformat(),
        },
    )

    import asyncio

    await asyncio.sleep(0.08)

    res = await test_client.get("/exp-link")
    assert res.status_code == 410
    assert "expired" in res.json()["message"]
