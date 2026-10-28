"""Shared exception flows: one exception request per claim, decided exception by exception

exception_requests.route_key: which shared exception route a request follows (CLAIM_EXCEPTIONS or
TRAVEL_EXCEPTIONS); NULL for requests raised before, which finish on their per-type chain.
exception_request_items: the exceptions listed on a claim's exception request.
exception_item_decisions: each approver's Accept / Reject / Send back on each exception, per step.

Additive only — existing rows are left as they are.

Revision ID: a3f7c9e1d5b2
Revises: e4b8c2f6a9d1
Create Date: 2026-10-28
"""

import sqlalchemy as sa

from alembic import op

revision = "a3f7c9e1d5b2"
down_revision = "e4b8c2f6a9d1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("exception_requests", sa.Column("route_key", sa.String(length=32), nullable=True))
    op.create_table(
        "exception_request_items",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "exception_request_id",
            sa.Integer(),
            sa.ForeignKey("exception_requests.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("exception_type", sa.String(length=128), nullable=False),
        sa.Column("expense_category_name", sa.String(length=128), nullable=True),
        sa.Column("claimed_amount", sa.Numeric(12, 2), nullable=True),
        sa.Column("cap_amount", sa.Numeric(12, 2), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="PENDING"),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index(
        "ix_exception_request_items_exception_request_id", "exception_request_items", ["exception_request_id"]
    )
    op.create_table(
        "exception_item_decisions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "item_id",
            sa.Integer(),
            sa.ForeignKey("exception_request_items.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "exception_approval_id",
            sa.Integer(),
            sa.ForeignKey("exception_approvals.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("decision", sa.String(length=32), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("decided_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("decided_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_exception_item_decisions_item_id", "exception_item_decisions", ["item_id"])
    op.create_index(
        "ix_exception_item_decisions_exception_approval_id", "exception_item_decisions", ["exception_approval_id"]
    )


def downgrade() -> None:
    # Dropping the tables drops their indexes too (MySQL won't drop an index a foreign key uses
    # on its own).
    op.drop_table("exception_item_decisions")
    op.drop_table("exception_request_items")
    op.drop_column("exception_requests", "route_key")
