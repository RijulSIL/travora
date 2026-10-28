"""Sign-in lockout, ending old sessions on a password change, whole-day delegation ends

login_failures counts wrong passwords in a row per email (known or not, so the lockout doesn't
tell anyone which emails have accounts) and when that email may sign in again.
users.password_changed_at: access tokens issued before it are refused (NULL for everyone now).
delegations.end_date: the end day was stored as 00:00, so the last day wasn't covered — moved to
23:59:59 of that day (new delegations are saved that way).

Revision ID: e4b8c2f6a9d1
Revises: b9d4f1a7c3e6
Create Date: 2026-10-28
"""

import sqlalchemy as sa

from alembic import op

revision = "e4b8c2f6a9d1"
down_revision = "b9d4f1a7c3e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "login_failures",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("email", sa.String(length=255), nullable=False, unique=True),
        sa.Column("failed_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("locked_until", sa.DateTime(), nullable=True),
        sa.Column("last_failed_at", sa.DateTime(), nullable=True),
    )
    op.add_column("users", sa.Column("password_changed_at", sa.DateTime(), nullable=True))
    op.execute(
        "UPDATE delegations SET end_date = TIMESTAMP(DATE(end_date), '23:59:59') "
        "WHERE TIME(end_date) = '00:00:00'"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE delegations SET end_date = TIMESTAMP(DATE(end_date), '00:00:00') "
        "WHERE TIME(end_date) = '23:59:59'"
    )
    op.drop_column("users", "password_changed_at")
    op.drop_table("login_failures")
