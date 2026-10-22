"""Audit chain head: one locked row so audit entries always link to the one before them

Starts from the newest existing entry. Entries added after this migration store whole-second
times, so their fingerprints can be recalculated; recheck_from_id marks where that starts.

Revision ID: e8a2c5f1d7b3
Revises: d3f6a8c1e2b9
Create Date: 2026-10-22
"""

import sqlalchemy as sa

from alembic import op

revision = "e8a2c5f1d7b3"
down_revision = "d3f6a8c1e2b9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "audit_chain_head",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("last_entry_id", sa.Integer(), nullable=True),
        sa.Column("last_event_hash", sa.String(64), nullable=True),
        sa.Column("recheck_from_id", sa.Integer(), nullable=False, server_default="1"),
    )
    conn = op.get_bind()
    latest = conn.execute(sa.text("SELECT id, event_hash FROM audit_logs ORDER BY id DESC LIMIT 1")).first()
    conn.execute(
        sa.text(
            "INSERT INTO audit_chain_head (id, last_entry_id, last_event_hash, recheck_from_id) "
            "VALUES (1, :entry_id, :event_hash, :recheck_from)"
        ),
        {
            "entry_id": latest[0] if latest else None,
            "event_hash": latest[1] if latest else None,
            "recheck_from": (latest[0] + 1) if latest else 1,
        },
    )


def downgrade() -> None:
    op.drop_table("audit_chain_head")
