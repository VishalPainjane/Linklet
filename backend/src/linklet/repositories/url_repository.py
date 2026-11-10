"""PostgreSQL repository for URL entity operations using SQLAlchemy 2.x."""

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import delete, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from linklet.errors import (
    AliasAlreadyTakenError,
    DependencyUnavailableError,
)
from linklet.models.analytics import UrlStats
from linklet.models.url import URL
from linklet.services.code_generator import CodeGenerator, default_code_generator


def get_insert_stmt(table: Any, session: AsyncSession) -> Any:
    """Return dialect-appropriate INSERT statement with ON CONFLICT support."""
    bind = session.bind
    if bind is not None and bind.dialect.name == "sqlite":
        return sqlite_insert(table)
    return pg_insert(table)


class UrlRepository:
    """Encapsulates PostgreSQL operations for short URLs."""

    def __init__(
        self,
        session: AsyncSession,
        code_gen: CodeGenerator = default_code_generator,
    ) -> None:
        self.session = session
        self.code_gen = code_gen

    async def get_by_code(self, code: str) -> URL | None:
        """Fetch URL record by primary key short code."""
        stmt = select(URL).where(URL.code == code)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def create_generated(
        self,
        destination_url: str,
        expires_at: datetime | None = None,
        owner_id: UUID | None = None,
        max_retries: int = 5,
    ) -> URL:
        """Create a new short link with a generated Base62 code and bounded collision retry."""
        for _attempt in range(max_retries):
            candidate = self.code_gen.generate()
            # PostgreSQL atomic INSERT ... ON CONFLICT DO NOTHING RETURNING
            stmt = (
                get_insert_stmt(URL, self.session)
                .values(
                    code=candidate,
                    destination_url=destination_url,
                    owner_id=owner_id,
                    is_custom=False,
                    expires_at=expires_at,
                )
                .on_conflict_do_nothing(index_elements=[URL.code])
                .returning(URL.code)
            )
            result = await self.session.execute(stmt)
            inserted_code = result.scalar_one_or_none()

            if inserted_code is not None:
                # Initialize empty stats record
                stats_stmt = (
                    get_insert_stmt(UrlStats, self.session)
                    .values(code=inserted_code, click_count=0)
                    .on_conflict_do_nothing(index_elements=[UrlStats.code])
                )
                await self.session.execute(stats_stmt)

                # Return fresh model
                created = await self.get_by_code(inserted_code)
                assert created is not None
                return created

        raise DependencyUnavailableError(
            f"Code collision retry budget exhausted after {max_retries} attempts."
        )

    async def create_custom(
        self,
        alias: str,
        destination_url: str,
        expires_at: datetime | None = None,
        owner_id: UUID | None = None,
    ) -> URL:
        """Claim a custom alias atomically. Fails with 409 if claimed by another row."""
        stmt = (
            get_insert_stmt(URL, self.session)
            .values(
                code=alias,
                destination_url=destination_url,
                owner_id=owner_id,
                is_custom=True,
                expires_at=expires_at,
            )
            .on_conflict_do_nothing(index_elements=[URL.code])
            .returning(URL.code)
        )
        result = await self.session.execute(stmt)
        inserted_code = result.scalar_one_or_none()

        if inserted_code is None:
            raise AliasAlreadyTakenError(alias)

        # Initialize empty stats record
        stats_stmt = (
            get_insert_stmt(UrlStats, self.session)
            .values(code=alias, click_count=0)
            .on_conflict_do_nothing(index_elements=[UrlStats.code])
        )
        await self.session.execute(stats_stmt)

        created = await self.get_by_code(inserted_code)
        assert created is not None
        return created

    async def disable(self, code: str) -> bool:
        """Mark a link disabled."""
        stmt = (
            update(URL)
            .where(URL.code == code, URL.disabled_at.is_(None))
            .values(disabled_at=datetime.now())
        )
        result = await self.session.execute(stmt)
        rowcount = getattr(result, "rowcount", 0)
        return bool(rowcount and rowcount > 0)

    async def delete_permanent(self, code: str) -> bool:
        """Hard delete a link and cascade its stats."""
        stmt = delete(URL).where(URL.code == code)
        result = await self.session.execute(stmt)
        rowcount = getattr(result, "rowcount", 0)
        return bool(rowcount and rowcount > 0)
