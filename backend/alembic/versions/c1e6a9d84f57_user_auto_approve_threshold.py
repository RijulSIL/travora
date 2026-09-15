"""add users.auto_approve_threshold

Revision ID: c1e6a9d84f57
Revises: b7d1e4f92a3c
Create Date: 2026-09-14 00:00:00.000000

"""
import sqlalchemy as sa
from alembic import op

revision = "c1e6a9d84f57"
down_revision = "b7d1e4f92a3c"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("auto_approve_threshold", sa.Numeric(12, 2), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "auto_approve_threshold")
