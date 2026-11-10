"""REST API routes for URL management."""

from fastapi import (
    APIRouter,
    Depends,
    Header,
    Response,
    status,
)
from sqlalchemy.ext.asyncio import AsyncSession

from linklet.api.deps import (
    get_cache,
    get_session,
    rate_limit_create_url,
)
from linklet.cache.interface import UrlCache
from linklet.schemas.analytics import UrlStatsResponse
from linklet.schemas.url import (
    CreateUrlRequest,
    CreateUrlResponse,
    UrlMetadataResponse,
)
from linklet.services.analytics_service import AnalyticsService
from linklet.services.url_service import UrlService

router = APIRouter(prefix="/api/v1/urls", tags=["urls"])


@router.post(
    "",
    response_model=CreateUrlResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit_create_url)],
)
async def create_url(
    payload: CreateUrlRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    session: AsyncSession = Depends(get_session),
    cache: UrlCache = Depends(get_cache),
) -> CreateUrlResponse:
    """Create a new shortened link or return existing for replayed idempotent requests."""
    service = UrlService(session=session, cache=cache)
    return await service.create_short_url(
        request=payload,
        principal_key="anonymous",  # Can be mapped to authenticated user ID when auth enabled
        idempotency_key=idempotency_key,
    )


@router.get(
    "/{code}",
    response_model=UrlMetadataResponse,
    status_code=status.HTTP_200_OK,
)
async def get_url_metadata(
    code: str,
    session: AsyncSession = Depends(get_session),
    cache: UrlCache = Depends(get_cache),
) -> UrlMetadataResponse:
    """Retrieve metadata and status for a short code."""
    service = UrlService(session=session, cache=cache)
    return await service.get_url_metadata(code)


@router.delete(
    "/{code}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def disable_url(
    code: str,
    session: AsyncSession = Depends(get_session),
    cache: UrlCache = Depends(get_cache),
) -> Response:
    """Disable a short URL and purge it from cache."""
    service = UrlService(session=session, cache=cache)
    await service.disable_url(code)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/{code}/stats",
    response_model=UrlStatsResponse,
    status_code=status.HTTP_200_OK,
)
async def get_url_stats(
    code: str,
    session: AsyncSession = Depends(get_session),
) -> UrlStatsResponse:
    """Retrieve aggregate click analytics for a short URL."""
    service = AnalyticsService(session=session)
    return await service.get_stats(code)
