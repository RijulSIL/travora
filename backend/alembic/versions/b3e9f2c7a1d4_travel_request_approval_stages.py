"""travel request configurable multi-stage approval chain

Revision ID: b3e9f2c7a1d4
Revises: c4d7b2f8e1a3
Create Date: 2026-10-05 00:00:00.000001

"""
import sqlalchemy as sa
from alembic import op

revision = "b3e9f2c7a1d4"
down_revision = "c4d7b2f8e1a3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "travel_requests",
        sa.Column("current_approval_stage", sa.Integer(), nullable=True),
    )
    op.create_table(
        "travel_request_approval_stages",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "travel_request_id",
            sa.Integer(),
            sa.ForeignKey("travel_requests.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("stage_number", sa.Integer(), nullable=False),
        sa.Column("stage_label", sa.String(128), nullable=False),
        sa.Column("required_role", sa.String(64), index=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="NOT_STARTED"),
        sa.Column("sla_deadline_at", sa.DateTime()),
        sa.Column("decided_at", sa.DateTime()),
        sa.Column("decided_by_user_id", sa.Integer(), sa.ForeignKey("users.id")),
        sa.Column("comment", sa.Text()),
    )


def downgrade() -> None:
    op.drop_table("travel_request_approval_stages")
    op.drop_column("travel_requests", "current_approval_stage")
