"""users.role — add CEO, GROUP_HEAD_HR, RECRUITER to the MySQL enum

0004_auth created the column with the original six roles; the later roles were only added to the
Role model. On a MySQL server without strict mode, saving one of them stored '' instead of
failing, and reading that row back breaks the users list.

Revision ID: c8a2e5f1b9d3
Revises: b1e4f6a0c2d7
Create Date: 2026-10-29
"""

import sqlalchemy as sa

from alembic import op

revision = "c8a2e5f1b9d3"
down_revision = "b1e4f6a0c2d7"
branch_labels = None
depends_on = None

_OLD_ROLES = ("EMPLOYEE", "REPORTING_MANAGER", "HRBP_HR", "PAYROLL", "FINANCE", "IT_ADMIN")
_NEW_ROLES = (*_OLD_ROLES, "CEO", "GROUP_HEAD_HR", "RECRUITER")


def upgrade() -> None:
    op.alter_column(
        "users",
        "role",
        existing_type=sa.Enum(*_OLD_ROLES, name="role"),
        type_=sa.Enum(*_NEW_ROLES, name="role"),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "users",
        "role",
        existing_type=sa.Enum(*_NEW_ROLES, name="role"),
        type_=sa.Enum(*_OLD_ROLES, name="role"),
        existing_nullable=False,
    )
