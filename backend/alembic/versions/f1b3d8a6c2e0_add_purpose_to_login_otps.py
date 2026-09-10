"""add purpose to login_otps

Revision ID: f1b3d8a6c2e0
Revises: c3a7f2e91b4d
Create Date: 2026-09-10 00:00:00.000000

"""
import sqlalchemy as sa

from alembic import op

revision = "f1b3d8a6c2e0"
down_revision = "c3a7f2e91b4d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "login_otps",
        sa.Column("purpose", sa.String(length=20), nullable=False, server_default="login"),
    )


def downgrade() -> None:
    op.drop_column("login_otps", "purpose")
