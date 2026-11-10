"""Messaging event schemas and data structures."""

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID, uuid4


@dataclass(frozen=True)
class ClickEventMessage:
    """Message payload published on redirect."""

    code: str
    occurred_at: datetime
    referrer_host: str | None = None
    user_agent_family: str | None = None
    country_code: str | None = None
    event_id: UUID = uuid4()
    schema_version: int = 1
    event_type: str = "url.click"

    def to_dict(self) -> dict[str, str | int | None]:
        return {
            "event_id": str(self.event_id),
            "schema_version": self.schema_version,
            "event_type": self.event_type,
            "code": self.code,
            "occurred_at": self.occurred_at.isoformat(),
            "referrer_host": self.referrer_host,
            "user_agent_family": self.user_agent_family,
            "country_code": self.country_code,
        }
