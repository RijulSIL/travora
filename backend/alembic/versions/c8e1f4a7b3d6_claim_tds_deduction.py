"""add tds_deduction column to claim_drafts

Revision ID: c8e1f4a7b3d6
Revises: b7d3e9f1a2c4
Create Date: 2026-09-28 00:00:00.000001

"""
import sqlalchemy as sa
from alembic import op

revision = "c8e1f4a7b3d6"
down_revision = "b7d3e9f1a2c4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "claim_drafts",
        sa.Column("tds_deduction", sa.Numeric(12, 2), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("claim_drafts", "tds_deduction")
