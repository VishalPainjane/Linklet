"""PostgreSQL repository for analytics queries."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from linklet.models.analytics import UrlStats


class AnalyticsRepository:
    """Repository for querying URL stats."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_stats_by_code(self, code: str) -> UrlStats | None:
        """Fetch click counters for given short code."""
        stmt = select(UrlStats).where(UrlStats.code == code)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()
