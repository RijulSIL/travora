"""auth users and refresh tokens

Revision ID: 0004_auth
Revises: 0003_employees_audit
Create Date: 2026-04-27
"""

import sqlalchemy as sa
from alembic import op

revision = "0004_auth"
down_revision = "0003_employees_audit"
branch_labels = None
depends_on = None


def upgrade() -> None:
    role_enum = sa.Enum(
        "EMPLOYEE",
        "REPORTING_MANAGER",
        "HRBP_HR",
        "PAYROLL",
        "FINANCE",
        "IT_ADMIN",
        name="role",
    )
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("employee_id", sa.String(length=64), sa.ForeignKey("employees.employee_id"), nullable=True),
        sa.Column("email", sa.String(length=255), nullable=False, unique=True),
        sa.Column("role", role_enum, nullable=False),
        sa.Column("mfa_verified", sa.Boolean(), nullable=False, default=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, default=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_users_id", "users", ["id"])
    op.create_index("ix_users_email", "users", ["email"])
    op.create_index("ix_users_employee_id", "users", ["employee_id"])

    op.create_table(
        "refresh_tokens",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("token_hash", sa.String(length=128), nullable=False, unique=True),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("revoked", sa.Boolean(), nullable=False, default=False),
    )
    op.create_index("ix_refresh_tokens_user_id", "refresh_tokens", ["user_id"])
    op.create_index("ix_refresh_tokens_token_hash", "refresh_tokens", ["token_hash"])


def downgrade() -> None:
    op.drop_table("refresh_tokens")
    op.drop_table("users")
