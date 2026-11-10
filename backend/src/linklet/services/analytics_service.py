"""Service for querying aggregated link analytics."""

from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from linklet.errors import UrlNotFoundError
from linklet.repositories.analytics_repository import AnalyticsRepository
from linklet.repositories.url_repository import UrlRepository
from linklet.schemas.analytics import UrlStatsResponse


class AnalyticsService:
    """Service providing aggregate analytics for short URLs."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.url_repo = UrlRepository(session)
        self.analytics_repo = AnalyticsRepository(session)

    async def get_stats(self, code: str) -> UrlStatsResponse:
        """Fetch click count and last clicked timestamp for given code."""
        url = await self.url_repo.get_by_code(code)
        if url is None:
            raise UrlNotFoundError(code)

        stats = await self.analytics_repo.get_stats_by_code(code)
        if stats is None:
            return UrlStatsResponse(
                code=code,
                click_count=0,
                last_clicked_at=None,
                updated_at=datetime.now(UTC),
            )

        return UrlStatsResponse(
            code=stats.code,
            click_count=stats.click_count,
            last_clicked_at=stats.last_clicked_at,
            updated_at=stats.updated_at,
        )
