"""URL model representing short links."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from linklet.models.base import Base


class URL(Base):
    """Short URL persistence record."""

    __tablename__ = "urls"

    code: Mapped[str] = mapped_column(String(32), primary_key=True)
    destination_url: Mapped[str] = mapped_column(Text, nullable=False)
    owner_id: Mapped[UUID | None] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    is_custom: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    disabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    owner = relationship("User", lazy="selectin")
    stats = relationship(
        "UrlStats", uselist=False, back_populates="url", cascade="all, delete-orphan"
    )

    __table_args__ = (
        CheckConstraint("length(code) > 0", name="code_not_empty"),
        CheckConstraint(
            "expires_at IS NULL OR expires_at > created_at",
            name="expiry_after_creation",
        ),
        Index(
            "urls_owner_created_idx",
            "owner_id",
            "created_at",
        ),
        Index(
            "urls_expiry_idx",
            "expires_at",
        ),
    )
