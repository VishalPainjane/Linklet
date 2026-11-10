"""create initial schema

Revision ID: 001_initial_schema
Revises:
Create Date: 2026-11-10 18:31:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "001_initial_schema"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. users table
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.String(length=255), unique=True, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )

    # 2. urls table
    op.create_table(
        "urls",
        sa.Column("code", sa.String(length=32), primary_key=True),
        sa.Column("destination_url", sa.Text(), nullable=False),
        sa.Column(
            "owner_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("is_custom", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("disabled_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("length(code) > 0", name="code_not_empty"),
        sa.CheckConstraint(
            "expires_at IS NULL OR expires_at > created_at",
            name="expiry_after_creation",
        ),
    )
    op.create_index("urls_owner_created_idx", "urls", ["owner_id", "created_at"])
    op.create_index("urls_expiry_idx", "urls", ["expires_at"])

    # 3. idempotency_keys table
    op.create_table(
        "idempotency_keys",
        sa.Column("principal_key", sa.String(length=128), primary_key=True),
        sa.Column("idempotency_key", sa.String(length=128), primary_key=True),
        sa.Column("request_hash", sa.String(length=64), nullable=False),
        sa.Column("response_status", sa.Integer(), nullable=True),
        sa.Column("response_body", postgresql.JSONB(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("idempotency_expiry_idx", "idempotency_keys", ["expires_at"])

    # 4. url_stats table
    op.create_table(
        "url_stats",
        sa.Column(
            "code",
            sa.String(length=32),
            sa.ForeignKey("urls.code", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("click_count", sa.BigInteger(), server_default=sa.text("0"), nullable=False),
        sa.Column("last_clicked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )

    # 5. processed_events table
    op.create_table(
        "processed_events",
        sa.Column("event_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "processed_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )

    # 6. click_events table
    op.create_table(
        "click_events",
        sa.Column("event_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "code",
            sa.String(length=32),
            sa.ForeignKey("urls.code", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("referrer_host", sa.Text(), nullable=True),
        sa.Column("user_agent_family", sa.String(length=64), nullable=True),
        sa.Column("country_code", sa.String(length=2), nullable=True),
    )
    op.create_index("click_events_code_time_idx", "click_events", ["code", "occurred_at"])


def downgrade() -> None:
    op.drop_table("click_events")
    op.drop_table("processed_events")
    op.drop_table("url_stats")
    op.drop_table("idempotency_keys")
    op.drop_table("urls")
    op.drop_table("users")
