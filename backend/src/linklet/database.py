"""SQLAlchemy 2.x async engine and session factory."""

from collections.abc import AsyncIterator

from fastapi import Request
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from linklet.config import settings


def create_engine_and_session_factory(
    url: str | None = None,
) -> tuple[AsyncEngine, async_sessionmaker[AsyncSession]]:
    """Create a configured async database engine and session maker."""
    target_url = url or settings.database_url
    # Support postgres:// / postgresql:// standard URL prefixes from hosted providers
    if target_url.startswith("postgres://"):
        target_url = target_url.replace("postgres://", "postgresql+asyncpg://", 1)
    elif target_url.startswith("postgresql://") and not target_url.startswith(
        "postgresql+asyncpg://"
    ):
        target_url = target_url.replace("postgresql://", "postgresql+asyncpg://", 1)

    # SQLite compatibility for fast memory/unit testing if needed
    if target_url.startswith("sqlite"):
        engine = create_async_engine(target_url, echo=settings.db_echo)
    else:
        engine = create_async_engine(
            target_url,
            pool_size=settings.db_pool_size,
            max_overflow=settings.db_max_overflow,
            pool_timeout=settings.db_pool_timeout,
            pool_recycle=settings.db_pool_recycle,
            pool_pre_ping=True,
            echo=settings.db_echo,
        )

    session_factory = async_sessionmaker(
        bind=engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    return engine, session_factory


async def get_db_session(request: Request) -> AsyncIterator[AsyncSession]:
    """FastAPI request dependency yielding an AsyncSession."""
    session_factory: async_sessionmaker[AsyncSession] = request.app.state.session_factory
    async with session_factory() as session:
        yield session
