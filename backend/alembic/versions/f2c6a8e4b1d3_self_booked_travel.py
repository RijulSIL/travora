"""Self-booked travel requests, and when the Travel Desk cancelled a booked trip

`booked_by` is COMPANY (the travel agent books once it's approved, as before) or SELF (the
employee booked their own tickets and attached one per leg with the request; it follows the
Approval Matrix's "Self-booked travel" route and is booked as soon as it's approved).
`desk_cancelled_at` is set when the Travel Desk cancels a booked trip.

Revision ID: f2c6a8e4b1d3
Revises: e7b3c1d5f9a2
Create Date: 2026-11-20
"""

import sqlalchemy as sa

from alembic import op

revision = "f2c6a8e4b1d3"
down_revision = "e7b3c1d5f9a2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "travel_requests",
        sa.Column("booked_by", sa.String(length=16), nullable=False, server_default="COMPANY"),
    )
    op.add_column("travel_requests", sa.Column("desk_cancelled_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("travel_requests", "desk_cancelled_at")
    op.drop_column("travel_requests", "booked_by")
