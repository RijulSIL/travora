"""phase 4 travel booking module

Revision ID: 0011_phase4_travel_booking
Revises: 0010_phase3_claim_workflow
Create Date: 2026-04-27
"""

import sqlalchemy as sa
from alembic import op

revision = "0011_phase4_travel_booking"
down_revision = "0010_phase3_claim_workflow"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    mode_enum = sa.Enum("FLIGHT", "TRAIN", "BUS", name="travelmode")
    trip_status_enum = sa.Enum("CONFIRMED", "CANCELLED", "WAITLIST", name="tripstatus")
    local_status_enum = sa.Enum("SUBMITTED", "APPROVED", "REJECTED", name="localconveyancestatus")
    if dialect != "mysql":
        mode_enum.create(bind, checkfirst=True)
        trip_status_enum.create(bind, checkfirst=True)
        local_status_enum.create(bind, checkfirst=True)

    op.create_table(
        "travel_trips",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("employee_user_id", sa.Integer(), nullable=False),
        sa.Column("mode", mode_enum, nullable=False),
        sa.Column("from_city", sa.String(length=128), nullable=False),
        sa.Column("to_city", sa.String(length=128), nullable=False),
        sa.Column("travel_date", sa.Date(), nullable=False),
        sa.Column("provider", sa.String(length=64), nullable=False),
        sa.Column("reference_id", sa.String(length=64), nullable=False),
        sa.Column("travel_class", sa.String(length=64), nullable=True),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("gst_invoice_requested", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("eticket_url", sa.String(length=512), nullable=True),
        sa.Column("booking_metadata", sa.JSON(), nullable=True),
        sa.Column("status", trip_status_enum, nullable=False),
        sa.Column("cancellation_reason", sa.Text(), nullable=True),
        sa.Column("refunded_amount", sa.Numeric(12, 2), nullable=True),
        sa.Column("boarding_pass_path", sa.String(length=512), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["employee_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_travel_trips_employee_user_id", "travel_trips", ["employee_user_id"])
    op.create_index("ix_travel_trips_mode", "travel_trips", ["mode"])
    op.create_index("ix_travel_trips_reference_id", "travel_trips", ["reference_id"])
    op.create_index("ix_travel_trips_travel_date", "travel_trips", ["travel_date"])

    op.create_table(
        "local_conveyance_claims",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("employee_user_id", sa.Integer(), nullable=False),
        sa.Column("trip_id", sa.Integer(), nullable=True),
        sa.Column("mode", sa.String(length=64), nullable=False),
        sa.Column("city", sa.String(length=128), nullable=True),
        sa.Column("travel_date", sa.Date(), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("distance_km", sa.Numeric(10, 2), nullable=True),
        sa.Column("bill_required", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("bill_reference", sa.String(length=512), nullable=True),
        sa.Column("manager_approval_required", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("claim_metadata", sa.JSON(), nullable=True),
        sa.Column("status", local_status_enum, nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["employee_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["trip_id"], ["travel_trips.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_local_conveyance_claims_employee_user_id", "local_conveyance_claims", ["employee_user_id"])
    op.create_index("ix_local_conveyance_claims_mode", "local_conveyance_claims", ["mode"])
    op.create_index("ix_local_conveyance_claims_trip_id", "local_conveyance_claims", ["trip_id"])


def downgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    op.drop_index("ix_local_conveyance_claims_trip_id", table_name="local_conveyance_claims")
    op.drop_index("ix_local_conveyance_claims_mode", table_name="local_conveyance_claims")
    op.drop_index("ix_local_conveyance_claims_employee_user_id", table_name="local_conveyance_claims")
    op.drop_table("local_conveyance_claims")

    op.drop_index("ix_travel_trips_travel_date", table_name="travel_trips")
    op.drop_index("ix_travel_trips_reference_id", table_name="travel_trips")
    op.drop_index("ix_travel_trips_mode", table_name="travel_trips")
    op.drop_index("ix_travel_trips_employee_user_id", table_name="travel_trips")
    op.drop_table("travel_trips")

    if dialect != "mysql":
        sa.Enum(name="localconveyancestatus").drop(bind, checkfirst=True)
        sa.Enum(name="tripstatus").drop(bind, checkfirst=True)
        sa.Enum(name="travelmode").drop(bind, checkfirst=True)
