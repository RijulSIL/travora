"""Travel requests: the traveler's pick for each leg, and saved option searches

travel_requests.leg_picks holds each leg's chosen flight/train/bus (or what the traveler asked
for instead), shown to the Travel Desk. travel_option_searches keeps recent searches so the same
route, date and classes aren't searched again within a few hours.

Revision ID: b9d4f1a7c3e6
Revises: a6c3e8f2b4d1
Create Date: 2026-10-23
"""

import sqlalchemy as sa

from alembic import op

revision = "b9d4f1a7c3e6"
down_revision = "a6c3e8f2b4d1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("travel_requests", sa.Column("leg_picks", sa.JSON(), nullable=True))
    op.create_table(
        "travel_option_searches",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("cache_key", sa.String(length=64), nullable=False, unique=True),
        sa.Column("mode", sa.String(length=16), nullable=False),
        sa.Column("from_city", sa.String(length=128), nullable=False),
        sa.Column("to_city", sa.String(length=128), nullable=False),
        sa.Column("travel_date", sa.Date(), nullable=False),
        sa.Column("classes", sa.String(length=128), nullable=False),
        sa.Column("results", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("travel_option_searches")
    op.drop_column("travel_requests", "leg_picks")
