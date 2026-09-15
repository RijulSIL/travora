"""add budget_config, department_budgets, manager_budgets

Revision ID: e7c4a1f9b3d2
Revises: d2f7b3a91c6e
Create Date: 2026-09-15 00:00:00.000000

"""
import sqlalchemy as sa
from alembic import op

revision = "e7c4a1f9b3d2"
down_revision = "d2f7b3a91c6e"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "budget_config",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    )

    op.create_table(
        "department_budgets",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("department", sa.String(length=255), nullable=False),
        sa.Column("monthly_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.UniqueConstraint("department", name="uq_department_budgets_department"),
    )
    op.create_index("ix_department_budgets_department", "department_budgets", ["department"])

    op.create_table(
        "manager_budgets",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("manager_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("monthly_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.UniqueConstraint("manager_user_id", name="uq_manager_budgets_manager"),
    )
    op.create_index("ix_manager_budgets_manager_user_id", "manager_budgets", ["manager_user_id"])


def downgrade() -> None:
    op.drop_index("ix_manager_budgets_manager_user_id", table_name="manager_budgets")
    op.drop_table("manager_budgets")
    op.drop_index("ix_department_budgets_department", table_name="department_budgets")
    op.drop_table("department_budgets")
    op.drop_table("budget_config")
