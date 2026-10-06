"""add immutable granted_amount to advance_requests (amount is now the mutable remaining figure)

Revision ID: a8e3f1c9b2d4
Revises: f7c2a8e4d1b6
Create Date: 2026-09-30 00:00:00.000001

"""
import sqlalchemy as sa
from alembic import op

revision = "a8e3f1c9b2d4"
down_revision = "f7c2a8e4d1b6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "advance_requests",
        sa.Column("granted_amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
    )
    # Existing rows predate this column — best-effort backfill from their current `amount`,
    # since we have no record of what they originally were granted before any edit/settle.
    op.execute("UPDATE advance_requests SET granted_amount = amount")


def downgrade() -> None:
    op.drop_column("advance_requests", "granted_amount")
