"""Pydantic schemas for analytics and events."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, computed_field


class UrlStatsResponse(BaseModel):
    """Aggregate statistics for a short URL."""

    model_config = ConfigDict(populate_by_name=True)

    code: str
    click_count: int
    last_clicked_at: datetime | None = None
    updated_at: datetime

    @computed_field
    @property
    def clickCount(self) -> int:
        return self.click_count

    @computed_field
    @property
    def lastClickedAt(self) -> datetime | None:
        return self.last_clicked_at

    @computed_field
    @property
    def updatedAt(self) -> datetime:
        return self.updated_at


class ClickEventPayload(BaseModel):
    """Message payload published to RabbitMQ broker."""

    model_config = ConfigDict(populate_by_name=True)

    event_id: UUID
    schema_version: int = 1
    event_type: str = "url.click"
    code: str
    occurred_at: datetime
    referrer_host: str | None = None
    user_agent_family: str | None = None
    country_code: str | None = None
