"""Which approval route a claim / travel request was set up on

`approval_route` is "CEO_REQUESTS" on the CEO's own claims and travel requests (they follow the
Approval Matrix's "CEO's requests" route) and NULL on everything else, which follows the usual
routes. Recorded when the route is set up, so items already in progress keep the route they
started on.

Revision ID: e7b3c1d5f9a2
Revises: d4a8b2c6e9f1
Create Date: 2026-11-19
"""

import sqlalchemy as sa

from alembic import op

revision = "e7b3c1d5f9a2"
down_revision = "d4a8b2c6e9f1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("claim_drafts", sa.Column("approval_route", sa.String(length=32), nullable=True))
    op.add_column("travel_requests", sa.Column("approval_route", sa.String(length=32), nullable=True))


def downgrade() -> None:
    op.drop_column("travel_requests", "approval_route")
    op.drop_column("claim_drafts", "approval_route")
