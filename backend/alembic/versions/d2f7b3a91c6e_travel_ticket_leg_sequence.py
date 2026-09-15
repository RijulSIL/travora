"""add travel_request_tickets.leg_sequence

Revision ID: d2f7b3a91c6e
Revises: c1e6a9d84f57
Create Date: 2026-09-14 00:00:00.000000

"""
import sqlalchemy as sa
from alembic import op

revision = "d2f7b3a91c6e"
down_revision = "c1e6a9d84f57"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "travel_request_tickets",
        sa.Column("leg_sequence", sa.Integer(), nullable=False, server_default="1"),
    )


def downgrade() -> None:
    op.drop_column("travel_request_tickets", "leg_sequence")
