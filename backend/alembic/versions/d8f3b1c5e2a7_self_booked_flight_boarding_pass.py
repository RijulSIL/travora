"""Self-booked flight trips get their ticket as the boarding pass: a claim refuses a flight trip
without one, and self-booked trips were created without it (the Travel Desk's upload sets it).
Fills it in for the self-booked flight trips already booked; new ones get it when booked.

Revision ID: d8f3b1c5e2a7
Revises: c4e9a2d6f8b1
Create Date: 2026-11-25
"""

import sqlalchemy as sa

from alembic import op

revision = "d8f3b1c5e2a7"
down_revision = "c4e9a2d6f8b1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(
        sa.text(
            "SELECT t.id, k.storage_path FROM travel_trips t "
            "JOIN travel_request_tickets k ON k.travel_trip_id = t.id "
            "JOIN travel_requests r ON r.id = k.travel_request_id "
            "WHERE r.booked_by = 'SELF' AND t.mode = 'FLIGHT' "
            "AND (t.boarding_pass_path IS NULL OR t.boarding_pass_path = '')"
        )
    ).all()
    for trip_id, path in rows:
        conn.execute(
            sa.text("UPDATE travel_trips SET boarding_pass_path = :p WHERE id = :id"),
            {"p": str(path).replace("\\", "/"), "id": trip_id},
        )


def downgrade() -> None:
    # Data only: the boarding passes stay (they are the trips' own tickets).
    pass
