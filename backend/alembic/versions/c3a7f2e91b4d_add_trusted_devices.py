"""add trusted devices (skip OTP on remembered devices)

Revision ID: c3a7f2e91b4d
Revises: 38d96bcddee2
Create Date: 2026-09-08
"""

import sqlalchemy as sa
from alembic import op

revision = "c3a7f2e91b4d"
down_revision = "38d96bcddee2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "trusted_devices",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("token_hash", sa.String(length=128), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("last_used_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash", name="uq_trusted_devices_token_hash"),
    )
    op.create_index("ix_trusted_devices_user_id", "trusted_devices", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_trusted_devices_user_id", table_name="trusted_devices")
    op.drop_table("trusted_devices")
