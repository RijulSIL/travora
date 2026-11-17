"""Nearby stations: the airports / railway stations nearest a place the searches don't know

nearby_stations keeps, per mode and place typed on a travel request (e.g. Paradeep), the nearest
airports (FLIGHT) or railway stations (TRAIN) that Gemini found, so that place is searched in
airline schedules or the train timetable and isn't looked up again.

Revision ID: c3f7a9d2e5b1
Revises: b8e1f5a3c9d7
Create Date: 2026-11-17
"""

import sqlalchemy as sa

from alembic import op

revision = "c3f7a9d2e5b1"
down_revision = "b8e1f5a3c9d7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "nearby_stations",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("cache_key", sa.String(length=160), nullable=False, unique=True),
        sa.Column("mode", sa.String(length=16), nullable=False),
        sa.Column("place", sa.String(length=128), nullable=False),
        sa.Column("stations", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("nearby_stations")
