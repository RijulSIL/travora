"""add user password and full name columns

Revision ID: 0015_user_password
Revises: 0014_align_expense_category_defaults
Create Date: 2026-04-27
"""

import sqlalchemy as sa
from alembic import op

revision = "0015_user_password"
down_revision = "0014_align_expense_category_defaults"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("full_name", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("hashed_password", sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "hashed_password")
    op.drop_column("users", "full_name")
