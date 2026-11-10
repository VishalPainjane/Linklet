"""Pytest configuration and async fixtures."""

import os
from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from linklet.cache.local_lru import LocalUrlCacheAdapter
from linklet.config import settings
from linklet.main import create_app
from linklet.messaging.publisher import MockEventPublisher
from linklet.models.base import Base


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture
async def test_engine() -> AsyncIterator[AsyncEngine]:
    """Provide a PostgreSQL async engine with connection pooling for testing."""
    target_url = os.environ.get(
        "TEST_DATABASE_URL",
        "postgresql+asyncpg://linklet:local-only-change-me@localhost:5433/linklet_test",
    )
    if target_url.startswith("postgres://"):
        target_url = target_url.replace("postgres://", "postgresql+asyncpg://", 1)
    elif target_url.startswith("postgresql://") and not target_url.startswith(
        "postgresql+asyncpg://"
    ):
        target_url = target_url.replace("postgresql://", "postgresql+asyncpg://", 1)

    engine = create_async_engine(
        target_url,
        pool_size=5,
        max_overflow=2,
        pool_timeout=2.0,
        echo=False,
    )

    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    except Exception as exc:
        await engine.dispose()
        pytest.skip(
            f"PostgreSQL unavailable at {target_url} ({exc}). "
            "Start PostgreSQL with 'docker compose -f infrastructure/docker-compose.yml up -d' "
            "to run database integration tests."
        )

    yield engine

    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
    except Exception:
        pass
    await engine.dispose()


@pytest.fixture
async def session_factory(
    test_engine: AsyncEngine,
) -> async_sessionmaker[AsyncSession]:
    """Provide sessionmaker bound to test database engine."""
    return async_sessionmaker(
        bind=test_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )


@pytest.fixture
async def test_session(
    session_factory: async_sessionmaker[AsyncSession],
) -> AsyncIterator[AsyncSession]:
    """Provide an isolated test session."""
    async with session_factory() as session:
        yield session


@pytest.fixture
def test_cache() -> LocalUrlCacheAdapter:
    """In-memory cache adapter for testing."""
    return LocalUrlCacheAdapter(capacity=1000)


@pytest.fixture
def test_publisher() -> MockEventPublisher:
    """In-memory event publisher for testing."""
    return MockEventPublisher()


@pytest.fixture
async def test_client(
    test_engine: AsyncEngine,
    session_factory: async_sessionmaker[AsyncSession],
    test_cache: LocalUrlCacheAdapter,
    test_publisher: MockEventPublisher,
) -> AsyncIterator[AsyncClient]:
    """Provide an AsyncClient making in-memory HTTP requests against Linklet API."""
    app = create_app()
    app.state.engine = test_engine
    app.state.session_factory = session_factory
    app.state.cache = test_cache
    app.state.publisher = test_publisher

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client
