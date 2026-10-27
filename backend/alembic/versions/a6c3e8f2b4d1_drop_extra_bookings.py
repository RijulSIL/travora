"""Travel requests no longer ask the company to book extra things: drop extra bookings

Removes the "book anything else" items (travel_request_booking_items), the per-item link on the
Travel Desk's documents (they stay, as optional additional documents), and the
needs_additional_booking / additional_booking_details columns. Everything removed was backed up
before this ran. The downgrade puts the table and columns back, empty.

Revision ID: a6c3e8f2b4d1
Revises: f2b6d9a4c7e1
Create Date: 2026-10-23
"""

import sqlalchemy as sa

from alembic import op

revision = "a6c3e8f2b4d1"
down_revision = "f2b6d9a4c7e1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    for fk in inspector.get_foreign_keys("travel_request_supporting_documents"):
        if fk["constrained_columns"] == ["booking_item_id"]:
            op.drop_constraint(fk["name"], "travel_request_supporting_documents", type_="foreignkey")
    op.drop_index(
        "ix_travel_request_supporting_documents_booking_item_id", table_name="travel_request_supporting_documents"
    )
    op.drop_column("travel_request_supporting_documents", "booking_item_id")

    op.drop_table("travel_request_booking_items")

    op.drop_column("travel_requests", "additional_booking_details")
    op.drop_column("travel_requests", "needs_additional_booking")


def downgrade() -> None:
    op.add_column(
        "travel_requests",
        sa.Column("needs_additional_booking", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("travel_requests", sa.Column("additional_booking_details", sa.Text(), nullable=True))
    op.create_table(
        "travel_request_booking_items",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "travel_request_id", sa.Integer(), sa.ForeignKey("travel_requests.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("description", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index(
        "ix_travel_request_booking_items_travel_request_id", "travel_request_booking_items", ["travel_request_id"]
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
