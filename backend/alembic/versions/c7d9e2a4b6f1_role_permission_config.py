"""add role_permission_config

Revision ID: c7d9e2a4b6f1
Revises: b3e9f2c7a1d4
Create Date: 2026-10-06 00:00:00.000000

"""
import sqlalchemy as sa

from alembic import op

revision = "c7d9e2a4b6f1"
down_revision = "b3e9f2c7a1d4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "role_permission_config",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("config_json", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    )
    # No seed row — an absent row means app.core.rbac's hardcoded PERMISSION_MATRIX /
    # DELEGATABLE_PERMISSIONS are authoritative, so every existing deployment's behavior is
    # unchanged until an admin explicitly saves a config via the new Permission Matrix page.


def downgrade() -> None:
    op.drop_table("role_permission_config")
