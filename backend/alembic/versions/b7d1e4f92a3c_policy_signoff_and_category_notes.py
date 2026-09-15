"""add policy_versions.approved_at and expense_categories.notes

Revision ID: b7d1e4f92a3c
Revises: a2c9e4b71f30
Create Date: 2026-09-11 00:00:00.000000

"""
import sqlalchemy as sa
from alembic import op

revision = "b7d1e4f92a3c"
down_revision = "a2c9e4b71f30"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "policy_versions",
        sa.Column("approved_at", sa.DateTime(), nullable=True),
    )
    op.add_column(
        "expense_categories",
        sa.Column("notes", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("expense_categories", "notes")
    op.drop_column("policy_versions", "approved_at")
