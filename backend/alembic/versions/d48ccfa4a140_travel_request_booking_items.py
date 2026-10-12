"""travel_request_booking_items — itemized "book anything else" needs

Replaces the single additional_booking_details free-text blob with one row per need (hotel,
cab, visa, ...), so the Travel Desk can attach a distinct proof document to each specific item
instead of one undifferentiated pile of files for the whole request. Existing requests that
already have needs_additional_booking=1 with real text in additional_booking_details get that
text backfilled as a single item, so they keep working under the new, item-based UI without a
special "legacy" code path. additional_booking_details itself is left in place (new submissions
just stop writing to it) purely so already-submitted requests keep their original wording.

Revision ID: d48ccfa4a140
Revises: f7bd38c5c419
Create Date: 2026-10-09
"""

import sqlalchemy as sa

from alembic import op

revision = "d48ccfa4a140"
down_revision = "f7bd38c5c419"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "travel_request_booking_items",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "travel_request_id",
            sa.Integer(),
            sa.ForeignKey("travel_requests.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("description", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index(
        "ix_travel_request_booking_items_travel_request_id",
        "travel_request_booking_items",
        ["travel_request_id"],
    )

    op.add_column(
        "travel_request_supporting_documents",
        sa.Column(
            "booking_item_id",
            sa.Integer(),
            sa.ForeignKey("travel_request_booking_items.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_travel_request_supporting_documents_booking_item_id",
        "travel_request_supporting_documents",
        ["booking_item_id"],
    )

    conn = op.get_bind()
    conn.execute(
        sa.text(
            "INSERT INTO travel_request_booking_items (travel_request_id, description) "
            "SELECT id, TRIM(additional_booking_details) FROM travel_requests "
            "WHERE needs_additional_booking = 1 "
            "AND additional_booking_details IS NOT NULL "
            "AND TRIM(additional_booking_details) != ''"
        )
    )


def downgrade() -> None:
    op.drop_index(
        "ix_travel_request_supporting_documents_booking_item_id",
        table_name="travel_request_supporting_documents",
    )
    op.drop_column("travel_request_supporting_documents", "booking_item_id")
    op.drop_index("ix_travel_request_booking_items_travel_request_id", table_name="travel_request_booking_items")
    op.drop_table("travel_request_booking_items")
