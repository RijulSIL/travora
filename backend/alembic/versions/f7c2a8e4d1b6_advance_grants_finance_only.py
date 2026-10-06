"""advance requests become finance-granted (drop approval chain, add creator)

Revision ID: f7c2a8e4d1b6
Revises: e5a7c3d9f1b4
Create Date: 2026-09-30 00:00:00.000001

"""
import sqlalchemy as sa
from alembic import op

revision = "f7c2a8e4d1b6"
down_revision = "e5a7c3d9f1b4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "advance_requests",
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    )
    op.drop_table("advance_approval_stages")


def downgrade() -> None:
    op.create_table(
        "advance_approval_stages",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "advance_id",
            sa.Integer(),
            sa.ForeignKey("advance_requests.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("stage_number", sa.Integer(), nullable=False),
        sa.Column("stage_label", sa.String(128), nullable=False),
        sa.Column("required_role", sa.String(64), index=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="PENDING"),
        sa.Column("sla_deadline_at", sa.DateTime()),
        sa.Column("decided_at", sa.DateTime()),
        sa.Column("decided_by_user_id", sa.Integer(), sa.ForeignKey("users.id")),
        sa.Column("comment", sa.Text()),
    )
    op.drop_column("advance_requests", "created_by_user_id")
