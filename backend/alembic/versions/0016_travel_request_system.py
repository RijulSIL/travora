"""travel request system tables and travel_trips extensions

Revision ID: 0016_travel_request_system
Revises: 0015_user_password
Create Date: 2026-04-29
"""

import sqlalchemy as sa
from alembic import op

revision = "0016_travel_request_system"
down_revision = "0015_user_password"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Use VARCHAR enums for portability (MySQL + sqlite test)."""
    op.create_table(
        "travel_requests",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("employee_user_id", sa.Integer(), nullable=False),
        sa.Column(
            "travel_mode",
            sa.String(length=16),
            nullable=False,
        ),  # FLIGHT | TRAIN | BUS — matches TravelMode
        sa.Column("from_city", sa.String(length=128), nullable=False),
        sa.Column("to_city", sa.String(length=128), nullable=False),
        sa.Column("travel_date", sa.Date(), nullable=False),
        sa.Column("return_date", sa.Date(), nullable=True),
        sa.Column("purpose", sa.Text(), nullable=True),
        sa.Column("preferred_class", sa.String(length=64), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "status",
            sa.String(length=24),
            nullable=False,
            server_default="PENDING",
        ),
        sa.Column("rejection_reason", sa.Text(), nullable=True),
        sa.Column("requested_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["employee_user_id"], ["users.id"], name="fk_travel_requests_employee_user_id"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_travel_requests_employee_user_id", "travel_requests", ["employee_user_id"])
    op.create_index("ix_travel_requests_status", "travel_requests", ["status"])
    op.create_index("ix_travel_requests_travel_date", "travel_requests", ["travel_date"])

    op.add_column("travel_trips", sa.Column("travel_request_id", sa.Integer(), nullable=True))
    op.add_column(
        "travel_trips",
        sa.Column("booked_by_travel_desk", sa.Boolean(), nullable=False, server_default=sa.text("0")),
    )
    op.add_column("travel_trips", sa.Column("assigned_to_employee_id", sa.String(length=64), nullable=True))

    op.create_foreign_key(
        "fk_travel_trips_travel_request_id",
        "travel_trips",
        "travel_requests",
        ["travel_request_id"],
        ["id"],
    )
    op.create_foreign_key(
        "fk_travel_trips_assigned_employee_id",
        "travel_trips",
        "employees",
        ["assigned_to_employee_id"],
        ["employee_id"],
    )

    op.create_table(
        "travel_request_tickets",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("travel_request_id", sa.Integer(), nullable=False),
        sa.Column("travel_trip_id", sa.Integer(), nullable=True),
        sa.Column("uploaded_by_user_id", sa.Integer(), nullable=False),
        sa.Column("file_sha256", sa.String(length=64), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("storage_path", sa.String(length=512), nullable=False),
        sa.Column("content_type", sa.String(length=128), nullable=False),
        sa.Column("file_size_bytes", sa.Integer(), nullable=False),
        sa.Column("pnr_or_booking_ref", sa.String(length=128), nullable=True),
        sa.Column("ticket_amount", sa.Numeric(12, 2), nullable=True),
        sa.Column("ticket_travel_class", sa.String(length=64), nullable=True),
        sa.Column("external_booking_source", sa.String(length=128), nullable=True),
        sa.Column("notes_for_employee", sa.Text(), nullable=True),
        sa.Column("uploaded_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["travel_request_id"], ["travel_requests.id"], name="fk_trt_travel_request_id"),
        sa.ForeignKeyConstraint(["travel_trip_id"], ["travel_trips.id"], name="fk_trt_travel_trip_id"),
        sa.ForeignKeyConstraint(["uploaded_by_user_id"], ["users.id"], name="fk_trt_uploaded_by"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_travel_request_tickets_travel_request_id", "travel_request_tickets", ["travel_request_id"]
    )
    op.create_index("ix_travel_request_tickets_travel_trip_id", "travel_request_tickets", ["travel_trip_id"])
    op.create_index(
        "ix_travel_request_tickets_uploaded_by_user_id", "travel_request_tickets", ["uploaded_by_user_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_travel_request_tickets_uploaded_by_user_id", table_name="travel_request_tickets")
    op.drop_index("ix_travel_request_tickets_travel_trip_id", table_name="travel_request_tickets")
    op.drop_index("ix_travel_request_tickets_travel_request_id", table_name="travel_request_tickets")
    op.drop_table("travel_request_tickets")

    op.drop_constraint("fk_travel_trips_assigned_employee_id", "travel_trips", type_="foreignkey")
    op.drop_constraint("fk_travel_trips_travel_request_id", "travel_trips", type_="foreignkey")

    op.drop_column("travel_trips", "assigned_to_employee_id")
    op.drop_column("travel_trips", "booked_by_travel_desk")
    op.drop_column("travel_trips", "travel_request_id")

    op.drop_index("ix_travel_requests_travel_date", table_name="travel_requests")
    op.drop_index("ix_travel_requests_status", table_name="travel_requests")
    op.drop_index("ix_travel_requests_employee_user_id", table_name="travel_requests")
    op.drop_table("travel_requests")
