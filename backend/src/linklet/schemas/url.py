"""Pydantic v2 schemas for URL requests and responses."""

import re
from datetime import datetime

from pydantic import (
    AliasChoices,
    BaseModel,
    ConfigDict,
    Field,
    computed_field,
    field_validator,
)

from linklet.config import settings

ALIAS_REGEX = re.compile(r"^[a-zA-Z0-9_-]{2,32}$")


class CreateUrlRequest(BaseModel):
    """Payload for creating or shortening a URL."""

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    url: str = Field(..., max_length=2048, description="Target destination URL")
    custom_alias: str | None = Field(
        default=None,
        validation_alias=AliasChoices("custom_alias", "customAlias"),
        max_length=32,
    )
    expires_at: datetime | None = Field(
        default=None,
        validation_alias=AliasChoices("expires_at", "expiresAt"),
    )

    @field_validator("url")
    @classmethod
    def validate_destination_url(cls, v: str) -> str:
        trimmed = v.strip()
        if not trimmed:
            raise ValueError("Destination URL cannot be empty.")
        if not (trimmed.startswith("http://") or trimmed.startswith("https://")):
            raise ValueError("Destination URL must use http or https scheme.")
        if len(trimmed) > 2048:
            raise ValueError("Destination URL exceeds maximum length of 2048 characters.")
        return trimmed

    @field_validator("custom_alias")
    @classmethod
    def validate_alias(cls, v: str | None) -> str | None:
        if v is None:
            return None
        trimmed = v.strip()
        if not trimmed:
            return None
        if trimmed.lower() in settings.reserved_aliases:
            raise ValueError(f"Custom alias '{trimmed}' is a reserved path.")
        if not ALIAS_REGEX.match(trimmed):
            raise ValueError(
                "Custom alias must be 2-32 characters long and contain only "
                "alphanumeric characters, underscores, or hyphens."
            )
        return trimmed

    @field_validator("expires_at")
    @classmethod
    def validate_expires(cls, v: datetime | None) -> datetime | None:
        if v is not None:
            now = datetime.now(v.tzinfo or datetime.now().astimezone().tzinfo)
            if v <= now:
                raise ValueError("Expiration time must be strictly in the future.")
        return v


class CreateUrlResponse(BaseModel):
    """Response returned upon short link creation."""

    model_config = ConfigDict(populate_by_name=True)

    code: str
    short_url: str
    destination_url: str
    expires_at: datetime | None = None
    created_at: datetime

    @computed_field
    @property
    def shortUrl(self) -> str:
        return self.short_url

    @computed_field
    @property
    def destinationUrl(self) -> str:
        return self.destination_url

    @computed_field
    @property
    def expiresAt(self) -> datetime | None:
        return self.expires_at

    @computed_field
    @property
    def createdAt(self) -> datetime:
        return self.created_at


class UrlMetadataResponse(BaseModel):
    """Public/authorized metadata inspection for a short code."""

    model_config = ConfigDict(populate_by_name=True)

    code: str
    short_url: str
    destination_url: str
    is_custom: bool = False
    created_at: datetime
    expires_at: datetime | None = None
    disabled_at: datetime | None = None
    is_active: bool

    @computed_field
    @property
    def shortUrl(self) -> str:
        return self.short_url

    @computed_field
    @property
    def destinationUrl(self) -> str:
        return self.destination_url

    @computed_field
    @property
    def isCustom(self) -> bool:
        return self.is_custom

    @computed_field
    @property
    def isActive(self) -> bool:
        return self.is_active

    @computed_field
    @property
    def createdAt(self) -> datetime:
        return self.created_at

    @computed_field
    @property
    def expiresAt(self) -> datetime | None:
        return self.expires_at

    @computed_field
    @property
    def disabledAt(self) -> datetime | None:
        return self.disabled_at
