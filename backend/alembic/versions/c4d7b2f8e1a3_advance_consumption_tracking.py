"""track per-grant consumption (via claims vs via settlement) so a grant's own remaining
amount always reflects real drawdown, independent of any other grant the same employee has

Revision ID: c4d7b2f8e1a3
Revises: a8e3f1c9b2d4
Create Date: 2026-09-30 00:00:00.000001

"""
from decimal import Decimal

import sqlalchemy as sa
from alembic import op

revision = "c4d7b2f8e1a3"
down_revision = "a8e3f1c9b2d4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "advance_requests",
        sa.Column("consumed_via_claims", sa.Numeric(12, 2), nullable=False, server_default="0"),
    )
    op.add_column(
        "advance_requests",
        sa.Column("consumed_via_settlement", sa.Numeric(12, 2), nullable=False, server_default="0"),
    )

    bind = op.get_bind()

    # Existing rows predate per-grant tracking. Outstanding used to be computed purely in
    # aggregate (sum of grant amounts minus sum of PAID claims' advance_received), so a grant's
    # own `amount` never reflected claim-driven consumption — only Settle Up ever touched it
    # directly. Crystallize both channels now so every grant's status stands on its own:
    #   1. Whatever gap already exists between granted_amount and amount was Settle Up's doing.
    bind.execute(sa.text("UPDATE advance_requests SET consumed_via_settlement = GREATEST(granted_amount - amount, 0)"))

    #   2. Replay each employee's historical claim-driven consumption as a FIFO drawdown
    #      against their grants (oldest first), same order Settle Up already draws in.
    employees = bind.execute(
        sa.text("SELECT DISTINCT employee_user_id FROM advance_requests WHERE status = 'APPROVED'")
    ).fetchall()
    for (employee_user_id,) in employees:
        claims_deducted = bind.execute(
            sa.text(
                "SELECT COALESCE(SUM(advance_received), 0) FROM claim_drafts "
                "WHERE employee_user_id = :eid AND status = 'PAID'"
            ),
            {"eid": employee_user_id},
        ).scalar() or 0
        remaining = Decimal(str(claims_deducted))
        if remaining <= 0:
            continue
        grants = bind.execute(
            sa.text(
                "SELECT id, amount FROM advance_requests "
                "WHERE employee_user_id = :eid AND status = 'APPROVED' ORDER BY created_at ASC"
            ),
            {"eid": employee_user_id},
        ).fetchall()
        for grant_id, amount in grants:
            if remaining <= 0:
                break
            amount = Decimal(str(amount))
            if amount <= 0:
                continue
            reduce_by = min(amount, remaining)
            bind.execute(
                sa.text(
                    "UPDATE advance_requests SET amount = amount - :r, consumed_via_claims = consumed_via_claims + :r "
                    "WHERE id = :gid"
                ),
                {"r": reduce_by, "gid": grant_id},
            )
            remaining -= reduce_by


def downgrade() -> None:
    op.drop_column("advance_requests", "consumed_via_settlement")
    op.drop_column("advance_requests", "consumed_via_claims")
