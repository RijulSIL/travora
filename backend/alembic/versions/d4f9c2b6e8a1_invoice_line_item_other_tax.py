"""add other_tax column to invoice_line_items

Revision ID: d4f9c2b6e8a1
Revises: c8e1f4a7b3d6
Create Date: 2026-09-29 00:00:00.000001

"""
import sqlalchemy as sa
from alembic import op

revision = "d4f9c2b6e8a1"
down_revision = "c8e1f4a7b3d6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "invoice_line_items",
        sa.Column("other_tax", sa.Numeric(12, 2), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("invoice_line_items", "other_tax")
