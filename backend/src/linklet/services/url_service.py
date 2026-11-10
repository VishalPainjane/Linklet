"""High-level URL management service implementing creation, idempotency, and invalidation."""

import asyncio
import hashlib
import json
import logging
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from linklet.cache.interface import UrlCache
from linklet.config import settings
from linklet.errors import (
    IdempotencyConflictError,
    UrlNotFoundError,
)
from linklet.models.idempotency import IdempotencyKey
from linklet.repositories.url_repository import UrlRepository
from linklet.schemas.url import (
    CreateUrlRequest,
    CreateUrlResponse,
    UrlMetadataResponse,
)

logger = logging.getLogger(__name__)


def compute_request_hash(data: dict[str, Any]) -> str:
    """Compute deterministic SHA-256 hash of sorted JSON payload."""
    serialized = json.dumps(data, sort_keys=True, default=str)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


class UrlService:
    """Domain service managing URLs and request idempotency."""

    def __init__(
        self,
        session: AsyncSession,
        cache: UrlCache,
        base_url: str = settings.public_short_base_url,
    ) -> None:
        self.session = session
        self.cache = cache
        self.base_url = base_url.rstrip("/")
        self.repo = UrlRepository(session=session)

    def _format_short_url(self, code: str) -> str:
        return f"{self.base_url}/{code}"

    async def create_short_url(
        self,
        request: CreateUrlRequest,
        principal_key: str = "anonymous",
        idempotency_key: str | None = None,
        owner_id: UUID | None = None,
    ) -> CreateUrlResponse:
        """Create or replay short URL creation."""
        normalized_dict = request.model_dump(by_alias=False, mode="json")
        req_hash = compute_request_hash(normalized_dict)

        if idempotency_key:
            now = datetime.now(UTC)
            expires_at = now + timedelta(days=7)
            # 1. Attempt to claim the idempotency key first atomically
            claim_stmt = (
                pg_insert(IdempotencyKey)
                .values(
                    principal_key=principal_key,
                    idempotency_key=idempotency_key,
                    request_hash=req_hash,
                    response_status=None,
                    response_body=None,
                    expires_at=expires_at,
                )
                .on_conflict_do_nothing(
                    index_elements=[IdempotencyKey.principal_key, IdempotencyKey.idempotency_key]
                )
                .returning(IdempotencyKey.principal_key)
            )
            claim_result = await self.session.execute(claim_stmt)
            claimed = claim_result.scalar_one_or_none()

            if claimed is None:
                # Another concurrent request claimed this idempotency key
                existing: IdempotencyKey | None = None
                for _ in range(50):
                    stmt = select(IdempotencyKey).where(
                        IdempotencyKey.principal_key == principal_key,
                        IdempotencyKey.idempotency_key == idempotency_key,
                    )
                    existing_res = await self.session.execute(stmt)
                    existing = existing_res.scalar_one_or_none()
                    if existing is not None:
                        if existing.request_hash != req_hash:
                            raise IdempotencyConflictError(idempotency_key)
                        if existing.response_body is not None:
                            return CreateUrlResponse.model_validate(existing.response_body)
                    await asyncio.sleep(0.02)

                if existing and existing.response_body:
                    return CreateUrlResponse.model_validate(existing.response_body)
                raise IdempotencyConflictError(idempotency_key)

        # Winner proceeds to creation
        if request.custom_alias:
            url_record = await self.repo.create_custom(
                alias=request.custom_alias,
                destination_url=request.url,
                expires_at=request.expires_at,
                owner_id=owner_id,
            )
        else:
            url_record = await self.repo.create_generated(
                destination_url=request.url,
                expires_at=request.expires_at,
                owner_id=owner_id,
            )

        response = CreateUrlResponse(
            code=url_record.code,
            short_url=self._format_short_url(url_record.code),
            destination_url=url_record.destination_url,
            expires_at=url_record.expires_at,
            created_at=url_record.created_at,
        )

        if idempotency_key:
            update_stmt = (
                update(IdempotencyKey)
                .where(
                    IdempotencyKey.principal_key == principal_key,
                    IdempotencyKey.idempotency_key == idempotency_key,
                )
                .values(
                    response_status=201,
                    response_body=response.model_dump(mode="json"),
                )
            )
            await self.session.execute(update_stmt)

        await self.session.commit()
        return response

    async def get_url_metadata(self, code: str) -> UrlMetadataResponse:
        """Fetch URL metadata."""
        record = await self.repo.get_by_code(code)
        if record is None:
            raise UrlNotFoundError(code)

        now = datetime.now(UTC)
        is_expired = record.expires_at is not None and record.expires_at <= now
        is_disabled = record.disabled_at is not None
        is_active = not is_expired and not is_disabled

        return UrlMetadataResponse(
            code=record.code,
            short_url=self._format_short_url(record.code),
            destination_url=record.destination_url,
            is_custom=record.is_custom,
            created_at=record.created_at,
            expires_at=record.expires_at,
            disabled_at=record.disabled_at,
            is_active=is_active,
        )

    async def disable_url(self, code: str) -> None:
        """Mark URL disabled and invalidate cache entry."""
        record = await self.repo.get_by_code(code)
        if record is None:
            raise UrlNotFoundError(code)

        updated = await self.repo.disable(code)
        await self.session.commit()

        if updated:
            # Purge cache
            await self.cache.delete(code)
