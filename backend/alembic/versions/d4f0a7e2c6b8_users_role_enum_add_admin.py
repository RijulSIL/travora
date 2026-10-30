"""users.role — add ADMIN to the MySQL enum

Same fix as c8a2e5f1b9d3: the Role model gained a new value (ADMIN, a pure approver assignable
to any Approval Matrix stage) but the actual MySQL enum column wasn't extended to match. Without
this, saving a user with role=ADMIN on a MySQL server without strict mode silently stores ''
instead of failing, and reading that row back breaks the users list.

Revision ID: d4f0a7e2c6b8
Revises: c8a2e5f1b9d3
Create Date: 2026-10-29
"""

import sqlalchemy as sa

from alembic import op

revision = "d4f0a7e2c6b8"
down_revision = "c8a2e5f1b9d3"
branch_labels = None
depends_on = None

_OLD_ROLES = ("EMPLOYEE", "REPORTING_MANAGER", "HRBP_HR", "PAYROLL", "FINANCE", "IT_ADMIN", "CEO", "GROUP_HEAD_HR", "RECRUITER")
_NEW_ROLES = (*_OLD_ROLES, "ADMIN")


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
