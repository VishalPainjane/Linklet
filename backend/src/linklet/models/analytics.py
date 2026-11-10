"""Analytics and event processing models."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from linklet.models.base import Base


class UrlStats(Base):
    """Aggregated counters for URL clicks."""

    __tablename__ = "url_stats"

    code: Mapped[str] = mapped_column(
        String(32), ForeignKey("urls.code", ondelete="CASCADE"), primary_key=True
    )
    click_count: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    last_clicked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    url = relationship("URL", back_populates="stats")


class ProcessedEvent(Base):
    """Consumer deduplication ledger to guarantee idempotent event consumption."""

    __tablename__ = "processed_events"

    event_id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    processed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class ClickEvent(Base):
    """Detailed click log record (optional historical audit)."""

    __tablename__ = "click_events"

    event_id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    code: Mapped[str] = mapped_column(
        String(32), ForeignKey("urls.code", ondelete="CASCADE"), nullable=False
    )
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    referrer_host: Mapped[str | None] = mapped_column(Text, nullable=True)
    user_agent_family: Mapped[str | None] = mapped_column(String(64), nullable=True)
    country_code: Mapped[str | None] = mapped_column(String(2), nullable=True)

    __table_args__ = (Index("click_events_code_time_idx", "code", "occurred_at"),)
