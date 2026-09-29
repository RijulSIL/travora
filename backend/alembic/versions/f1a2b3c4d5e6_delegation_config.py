"""add delegation_config

Revision ID: f1a2b3c4d5e6
Revises: a3f7d9c1e5b2
Create Date: 2026-09-25 00:00:00.000000

"""
import sqlalchemy as sa
from alembic import op

revision = "f1a2b3c4d5e6"
down_revision = "a3f7d9c1e5b2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "delegation_config",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("delegation_config")
