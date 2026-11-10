"""Pytest configuration and async fixtures."""

from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from linklet.cache.local_lru import LocalUrlCacheAdapter
from linklet.main import create_app
from linklet.messaging.publisher import MockEventPublisher
from linklet.models.base import Base


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture
async def test_engine(tmp_path: Path) -> AsyncIterator[AsyncEngine]:
    """Provide an isolated temporary file-based SQLite async engine with concurrency support."""
    db_file = tmp_path / "test_linklet.db"
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{db_file}",
        connect_args={"timeout": 30.0},
        echo=False,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield engine
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
