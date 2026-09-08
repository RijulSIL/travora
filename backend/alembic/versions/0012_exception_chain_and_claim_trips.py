"""exception approval chain and claim-trip links

Revision ID: 0012_exception_chain_and_claim_trips
Revises: 0011_phase4_travel_booking
Create Date: 2026-04-27
"""

import sqlalchemy as sa
from alembic import op

revision = "0012_exception_chain_and_claim_trips"
down_revision = "0011_phase4_travel_booking"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "claim_trips",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("claim_id", sa.Integer(), nullable=False),
        sa.Column("trip_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["claim_id"], ["claim_drafts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["trip_id"], ["travel_trips.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("claim_id", "trip_id", name="uq_claim_trips_claim_trip"),
    )
    op.create_index("ix_claim_trips_claim_id", "claim_trips", ["claim_id"])
    op.create_index("ix_claim_trips_trip_id", "claim_trips", ["trip_id"])

    op.create_table(
        "exception_approvals",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("exception_request_id", sa.Integer(), nullable=False),
        sa.Column("required_role", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("acted_by_user_id", sa.Integer(), nullable=True),
        sa.Column("acted_at", sa.DateTime(), nullable=True),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["exception_request_id"], ["exception_requests.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["acted_by_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("exception_request_id", "required_role", name="uq_exception_approvals_req_role"),
    )
    op.create_index("ix_exception_approvals_exception_request_id", "exception_approvals", ["exception_request_id"])
    op.create_index("ix_exception_approvals_required_role", "exception_approvals", ["required_role"])


def downgrade() -> None:
    op.drop_index("ix_exception_approvals_required_role", table_name="exception_approvals")
    op.drop_index("ix_exception_approvals_exception_request_id", table_name="exception_approvals")
    op.drop_table("exception_approvals")

    op.drop_index("ix_claim_trips_trip_id", table_name="claim_trips")
    op.drop_index("ix_claim_trips_claim_id", table_name="claim_trips")
    op.drop_table("claim_trips")
