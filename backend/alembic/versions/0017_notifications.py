"""notifications inbox table

Revision ID: 0017_notifications
Revises: 0016_travel_request_system
Create Date: 2026-04-29
"""

import sqlalchemy as sa
from alembic import op

revision = "0017_notifications"
down_revision = "0016_travel_request_system"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "notifications",
        sa.Column("sqlid", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("link", sa.String(length=512), nullable=True),
        sa.Column(
            "category",
            sa.Enum(
                "APPROVAL_REQUIRED",
                "CLAIM_UPDATE",
                "PAYMENT",
                "SLA_BREACH",
                "ADVANCE",
                "EXCEPTION",
                "SYSTEM",
                name="notificationcategory",
            ),
            nullable=False,
        ),
        sa.Column("is_read", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("sqlid"),
    )
    op.create_index("ix_notifications_user_id", "notifications", ["user_id"])
    op.create_index("ix_notifications_is_read", "notifications", ["is_read"])
    op.create_index("ix_notifications_created_at", "notifications", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_notifications_created_at", table_name="notifications")
    op.drop_index("ix_notifications_is_read", table_name="notifications")
    op.drop_index("ix_notifications_user_id", table_name="notifications")
    op.drop_table("notifications")
