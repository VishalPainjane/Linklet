"""SQLAlchemy 2.x async PostgreSQL engine and session factory with connection pooling."""

from collections.abc import AsyncIterator
from typing import Any

from fastapi import Request
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from linklet.config import settings


def normalize_database_url(raw_url: str) -> tuple[str, dict[str, Any]]:
    """Normalize a database connection string for SQLAlchemy asyncpg.

    Handles:
    - Dialect rewrite: postgres:// or postgresql:// -> postgresql+asyncpg://
    - Neon / libpq query parameters: sslmode -> ssl, strips channel_binding
    - Neon / PgBouncer connection pooler compatibility: statement_cache_size = 0
    """
    url_obj = make_url(raw_url)
    drivername = url_obj.drivername
    if drivername in ("postgres", "postgresql"):
        drivername = "postgresql+asyncpg"
    elif drivername.startswith("postgresql+") and "asyncpg" not in drivername:
        drivername = "postgresql+asyncpg"

    query_params = dict(url_obj.query)
    sslmode = query_params.pop("sslmode", None)
    query_params.pop("channel_binding", None)
    if sslmode in ("require", "prefer", "verify-ca", "verify-full"):
        query_params["ssl"] = "require"

    connect_args: dict[str, Any] = {}
    host = url_obj.host or ""
    if "pooler" in host or "pgbouncer" in host or "neon.tech" in host:
        connect_args["statement_cache_size"] = 0
        connect_args["prepared_statement_cache_size"] = 0

    clean_url = url_obj.set(drivername=drivername, query=query_params).render_as_string(
        hide_password=False
    )
    return clean_url, connect_args


def create_engine_and_session_factory(
    url: str | None = None,
) -> tuple[AsyncEngine, async_sessionmaker[AsyncSession]]:
    """Create a configured async PostgreSQL database engine with connection pooling."""
    target_url = url or settings.database_url
    clean_url, extra_connect_args = normalize_database_url(target_url)

    connect_args: dict[str, Any] = {}
    connect_args.update(extra_connect_args)

    engine = create_async_engine(
        clean_url,
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
        pool_timeout=settings.db_pool_timeout,
        pool_recycle=settings.db_pool_recycle,
        pool_pre_ping=True,
        echo=settings.db_echo,
        connect_args=connect_args,
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
