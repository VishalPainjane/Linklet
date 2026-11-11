"""add_password_hash_to_users

Revision ID: 336ba24bda04
Revises: 61c89067fb41
Create Date: 2026-11-11 19:09:41.291686

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '336ba24bda04'
down_revision: str | Sequence[str] | None = '61c89067fb41'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("users", sa.Column("password_hash", sa.String(length=255), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("users", "password_hash")

