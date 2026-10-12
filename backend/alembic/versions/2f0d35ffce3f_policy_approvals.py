"""policy_approvals table — configurable policy-approval chain, mirrors exception_approvals

Revision ID: 2f0d35ffce3f
Revises: c7d9e2a4b6f1
Create Date: 2026-10-07
"""

import sqlalchemy as sa
from alembic import op

revision = "2f0d35ffce3f"
down_revision = "c7d9e2a4b6f1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "policy_approvals",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("policy_version_id", sa.Integer(), nullable=False),
        sa.Column("required_role", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("acted_by_user_id", sa.Integer(), nullable=True),
        sa.Column("acted_at", sa.DateTime(), nullable=True),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["policy_version_id"], ["policy_versions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["acted_by_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("policy_version_id", "required_role", name="uq_policy_approvals_version_role"),
    )
    op.create_index("ix_policy_approvals_policy_version_id", "policy_approvals", ["policy_version_id"])
    op.create_index("ix_policy_approvals_required_role", "policy_approvals", ["required_role"])


def downgrade() -> None:
    op.drop_index("ix_policy_approvals_required_role", table_name="policy_approvals")
    op.drop_index("ix_policy_approvals_policy_version_id", table_name="policy_approvals")
    op.drop_table("policy_approvals")
