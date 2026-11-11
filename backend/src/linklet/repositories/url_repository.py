"""PostgreSQL repository for URL entity operations using SQLAlchemy 2.x."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import case, delete, func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from linklet.errors import (
    AliasAlreadyTakenError,
    DependencyUnavailableError,
)
from linklet.models.analytics import UrlStats
from linklet.models.url import URL
from linklet.services.code_generator import CodeGenerator, default_code_generator


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
                pg_insert(URL)
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
                    pg_insert(UrlStats)
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
            pg_insert(URL)
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
            pg_insert(UrlStats)
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

    async def enable(self, code: str) -> bool:
        """Mark a disabled link active again."""
        stmt = (
            update(URL)
            .where(URL.code == code, URL.disabled_at.is_not(None))
            .values(disabled_at=None)
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

    async def list_urls(
        self,
        owner_id: UUID | None = None,
        limit: int = 50,
        offset: int = 0,
        status_filter: str | None = None,
    ) -> tuple[list[tuple[URL, int, datetime | None]], int, int, int]:
        """List URLs with aggregate click statistics, total count, total clicks, and active."""
        base_stmt = select(
            URL,
            func.coalesce(UrlStats.click_count, 0).label("click_count"),
            UrlStats.last_clicked_at,
        ).outerjoin(UrlStats, URL.code == UrlStats.code)

        summary_stmt = select(
            func.count(URL.code).label("total"),
            func.coalesce(func.sum(UrlStats.click_count), 0).label("total_clicks"),
            func.coalesce(
                func.sum(case((URL.disabled_at.is_(None), 1), else_=0)), 0
            ).label("active_count"),
        ).outerjoin(UrlStats, URL.code == UrlStats.code)

        if owner_id is not None:
            base_stmt = base_stmt.where(URL.owner_id == owner_id)
            summary_stmt = summary_stmt.where(URL.owner_id == owner_id)

        if status_filter == "active":
            base_stmt = base_stmt.where(URL.disabled_at.is_(None))
            summary_stmt = summary_stmt.where(URL.disabled_at.is_(None))
        elif status_filter in ("deleted", "tombstone"):
            base_stmt = base_stmt.where(URL.disabled_at.is_not(None))
            summary_stmt = summary_stmt.where(URL.disabled_at.is_not(None))

        summary_res = await self.session.execute(summary_stmt)
        summary_row = summary_res.first()
        total = int(summary_row[0]) if summary_row else 0
        total_clicks = int(summary_row[1]) if summary_row else 0
        active_count = int(summary_row[2]) if summary_row else 0

        query_stmt = base_stmt.order_by(URL.created_at.desc()).limit(limit).offset(offset)
        result = await self.session.execute(query_stmt)
        rows: list[tuple[URL, int, datetime | None]] = [
            (row[0], int(row[1]), row[2]) for row in result.all()
        ]
        return rows, total, total_clicks, active_count
