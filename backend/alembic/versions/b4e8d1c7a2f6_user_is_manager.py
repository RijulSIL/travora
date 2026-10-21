"""users.is_manager — the Manager setting, replacing the Reporting Manager role

A role is now a person's job (Employee, Finance, HR, ...); is_manager says whether people can
report to them, and gives the Manager permissions (the REPORTING_MANAGER row in Role
permissions) on top of their role. The CEO is always a manager.

Data: everyone who is a Reporting Manager, the CEO, or already has people reporting to them gets
is_manager = 1, and Reporting Managers become Employees (Employee + Manager keeps exactly what
they could do). The downgrade turns Employee + Manager back into Reporting Manager.

Revision ID: b4e8d1c7a2f6
Revises: a9c3e5f1b2d7
Create Date: 2026-10-21
"""

import sqlalchemy as sa

from alembic import op

revision = "b4e8d1c7a2f6"
down_revision = "a9c3e5f1b2d7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("is_manager", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.execute(
        """
        UPDATE users SET is_manager = 1
        WHERE role IN ('REPORTING_MANAGER', 'CEO')
           OR employee_id IN (
                SELECT reporting_manager_id FROM (
                    SELECT DISTINCT reporting_manager_id FROM employees
                    WHERE reporting_manager_id IS NOT NULL AND is_active = 1
                ) AS managing
           )
        """
    )
    op.execute("UPDATE users SET role = 'EMPLOYEE' WHERE role = 'REPORTING_MANAGER'")


def downgrade() -> None:
    op.execute("UPDATE users SET role = 'REPORTING_MANAGER' WHERE role = 'EMPLOYEE' AND is_manager = 1")
    op.drop_column("users", "is_manager")
