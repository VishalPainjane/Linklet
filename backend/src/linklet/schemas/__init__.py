"""Schemas package."""

from linklet.schemas.analytics import ClickEventPayload, UrlStatsResponse
from linklet.schemas.url import (
    CreateUrlRequest,
    CreateUrlResponse,
    UrlMetadataResponse,
)

__all__ = [
    "CreateUrlRequest",
    "CreateUrlResponse",
    "UrlMetadataResponse",
    "UrlStatsResponse",
    "ClickEventPayload",
]

