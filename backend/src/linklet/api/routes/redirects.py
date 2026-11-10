"""HTTP redirect endpoints with cache-aside lookup and async click telemetry."""

from fastapi import (
    APIRouter,
    Depends,
    Header,
    Request,
    Response,
    status,
)
from sqlalchemy.ext.asyncio import AsyncSession

from linklet.api.deps import get_cache, get_publisher, get_session
from linklet.cache.interface import UrlCache
from linklet.messaging.publisher import EventPublisher, MockEventPublisher
from linklet.services.redirect_service import RedirectService

router = APIRouter(tags=["redirects"])


@router.get("/{code}", status_code=status.HTTP_302_FOUND)
async def redirect_get(
    code: str,
    request: Request,
    referer: str | None = Header(default=None),
    user_agent: str | None = Header(default=None),
    cf_ipcountry: str | None = Header(default=None, alias="CF-IPCountry"),
    session: AsyncSession = Depends(get_session),
    cache: UrlCache = Depends(get_cache),
    publisher: EventPublisher = Depends(get_publisher),
) -> Response:
    """Redirect to target destination and enqueue click event."""
    service = RedirectService(
        session=session,
        cache=cache,
        publisher=publisher,
    )
    destination = await service.resolve(
        code=code,
        referrer=referer,
        user_agent=user_agent,
        country=cf_ipcountry,
    )

    headers = {
        "Location": destination,
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Pragma": "no-cache",
    }
    return Response(
        status_code=status.HTTP_302_FOUND,
        headers=headers,
    )


@router.head("/{code}", status_code=status.HTTP_302_FOUND)
async def redirect_head(
    code: str,
    session: AsyncSession = Depends(get_session),
    cache: UrlCache = Depends(get_cache),
) -> Response:
    """HEAD inspection for link existence and destination header without incrementing clicks."""
    # Using a dummy publisher so HEAD does not emit click events
    dummy_publisher = MockEventPublisher()
    service = RedirectService(
        session=session,
        cache=cache,
        publisher=dummy_publisher,
    )
    destination = await service.resolve(code=code)

    headers = {
        "Location": destination,
        "Cache-Control": "no-store, no-cache, must-revalidate",
    }
    return Response(
        status_code=status.HTTP_302_FOUND,
        headers=headers,
    )

