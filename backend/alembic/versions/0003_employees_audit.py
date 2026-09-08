"""employees and audit logs

Revision ID: 0003_employees_audit
Revises: 0002_policy_models
Create Date: 2026-04-27
"""

import sqlalchemy as sa
from alembic import op

revision = "0003_employees_audit"
down_revision = "0002_policy_models"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "employees",
        sa.Column("employee_id", sa.String(length=64), primary_key=True),
        sa.Column("full_name", sa.String(length=255), nullable=False),
        sa.Column("designation", sa.String(length=255), nullable=True),
        sa.Column("impact_level_id", sa.Integer(), sa.ForeignKey("impact_levels.id"), nullable=True),
        sa.Column("reporting_manager_id", sa.String(length=64), nullable=True),
        sa.Column("business_unit", sa.String(length=255), nullable=True),
        sa.Column("department", sa.String(length=255), nullable=True),
        sa.Column("office_location", sa.String(length=255), nullable=True),
        sa.Column("cost_centre", sa.String(length=128), nullable=True),
        sa.Column("bank_account_details", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, default=True),
        sa.Column("last_synced_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["reporting_manager_id"], ["employees.employee_id"]),
    )
    op.create_index("ix_employees_department", "employees", ["department"])
    op.create_index("ix_employees_impact_level_id", "employees", ["impact_level_id"])
    op.create_index("ix_employees_reporting_manager_id", "employees", ["reporting_manager_id"])

    op.create_table(
        "audit_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("entity_type", sa.String(length=100), nullable=False),
        sa.Column("entity_id", sa.String(length=100), nullable=False),
        sa.Column("action", sa.String(length=100), nullable=False),
        sa.Column("actor_id", sa.Integer(), nullable=True),
        sa.Column("old_value", sa.JSON(), nullable=True),
        sa.Column("new_value", sa.JSON(), nullable=True),
        sa.Column("timestamp", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_audit_logs_entity_type", "audit_logs", ["entity_type"])
    op.create_index("ix_audit_logs_entity_id", "audit_logs", ["entity_id"])
    op.create_index("ix_audit_logs_action", "audit_logs", ["action"])


def downgrade() -> None:
    op.drop_table("audit_logs")
    op.drop_table("employees")
