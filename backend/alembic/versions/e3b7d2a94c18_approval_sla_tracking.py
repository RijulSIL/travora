"""approval SLA tracking — reminders, breach marker, exception-step deadlines

Approval SLAs now count working time only (weekends and Holiday Calendar days don't count), an
overdue step passes to the next approver (except the last one in its chain), and the current
approver is reminded every 4 working hours. Each approval step records when its approver was
last emailed and when its SLA ran out; exception approval steps also get an SLA deadline of
their own (they had none before).

Revision ID: e3b7d2a94c18
Revises: c9a4e1f7b2d6
Create Date: 2026-10-13
"""

import sqlalchemy as sa

from alembic import op

revision = "e3b7d2a94c18"
down_revision = "c9a4e1f7b2d6"
branch_labels = None
depends_on = None

_STAGE_TABLES = ("claim_approval_stages", "travel_request_approval_stages")


def upgrade() -> None:
    for table in _STAGE_TABLES:
        op.add_column(table, sa.Column("last_notified_at", sa.DateTime(), nullable=True))
        op.add_column(table, sa.Column("sla_breached_at", sa.DateTime(), nullable=True))
    op.add_column("exception_approvals", sa.Column("sla_deadline_at", sa.DateTime(), nullable=True))
    op.add_column("exception_approvals", sa.Column("last_notified_at", sa.DateTime(), nullable=True))
    op.add_column("exception_approvals", sa.Column("sla_breached_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("exception_approvals", "sla_breached_at")
    op.drop_column("exception_approvals", "last_notified_at")
    op.drop_column("exception_approvals", "sla_deadline_at")
    for table in _STAGE_TABLES:
        op.drop_column(table, "sla_breached_at")
        op.drop_column(table, "last_notified_at")
