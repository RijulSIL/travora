"""add taxable_value column to claim_expenses

Revision ID: e5a7c3d9f1b4
Revises: d4f9c2b6e8a1
Create Date: 2026-09-29 00:00:00.000001

"""
import sqlalchemy as sa
from alembic import op

revision = "e5a7c3d9f1b4"
down_revision = "d4f9c2b6e8a1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "claim_expenses",
        sa.Column("taxable_value", sa.Numeric(12, 2), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("claim_expenses", "taxable_value")
