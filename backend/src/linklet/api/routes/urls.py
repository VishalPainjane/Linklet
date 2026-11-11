"""REST API routes for URL management."""

from typing import Any
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    Header,
    Query,
    Response,
    status,
)
from sqlalchemy.ext.asyncio import AsyncSession

from linklet.api.deps import (
    get_cache,
    get_current_user,
    get_current_user_optional,
    get_session,
    rate_limit_create_url,
)
from linklet.cache.interface import UrlCache
from linklet.schemas.analytics import UrlStatsResponse
from linklet.schemas.url import (
    CreateUrlRequest,
    CreateUrlResponse,
    UrlListResponse,
    UrlMetadataResponse,
)
from linklet.services.analytics_service import AnalyticsService
from linklet.services.url_service import UrlService

router = APIRouter(prefix="/api/v1/urls", tags=["urls"])


@router.get(
    "",
    response_model=UrlListResponse,
    status_code=status.HTTP_200_OK,
)
async def list_urls(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    status_filter: str | None = Query(default=None, alias="status"),
    user: dict[str, Any] = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    cache: UrlCache = Depends(get_cache),
) -> UrlListResponse:
    """List shortened URLs belonging exclusively to the authenticated user."""
    service = UrlService(session=session, cache=cache)
    owner_id = UUID(user["id"])
    return await service.list_urls(
        owner_id=owner_id,
        limit=limit,
        offset=offset,
        status_filter=status_filter,
    )


@router.post(
    "",
    response_model=CreateUrlResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit_create_url)],
)
async def create_url(
    payload: CreateUrlRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    user: dict[str, Any] | None = Depends(get_current_user_optional),
    session: AsyncSession = Depends(get_session),
    cache: UrlCache = Depends(get_cache),
) -> CreateUrlResponse:
    """Create a new shortened link or return existing for replayed idempotent requests."""
    service = UrlService(session=session, cache=cache)
    principal_key = user["id"] if user else "anonymous"
    owner_id = UUID(user["id"]) if user else None
    return await service.create_short_url(
        request=payload,
        principal_key=principal_key,
        idempotency_key=idempotency_key,
        owner_id=owner_id,
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


@router.post(
    "/{code}/enable",
    response_model=UrlMetadataResponse,
    status_code=status.HTTP_200_OK,
)
async def enable_url(
    code: str,
    session: AsyncSession = Depends(get_session),
    cache: UrlCache = Depends(get_cache),
) -> UrlMetadataResponse:
    """Re-enable a previously disabled short URL and clear its tombstone."""
    service = UrlService(session=session, cache=cache)
    return await service.enable_url(code)


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

