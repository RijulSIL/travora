"""travel request: project/non-project, admin-managed options, additional booking, supporting docs

Adds travel_type / project_code / needs_additional_booking / additional_booking_details to
travel_requests, the admin-managed travel_request_options table that backs the Project Code and
Trip Purpose dropdowns, and travel_request_supporting_documents for the Travel Desk's uploads
against a request's "book anything else" ask. preferred_class (Preferred Cabin Class) and the
Travel Desk ticket amount / class / external-source columns stop being written but stay in the
schema so existing rows keep their data.

Revision ID: 7a1c5e9d3b20
Revises: 6b035c0064aa
Create Date: 2026-10-09
"""

import sqlalchemy as sa

from alembic import op

revision = "7a1c5e9d3b20"
down_revision = "6b035c0064aa"
branch_labels = None
depends_on = None

_DEFAULT_PURPOSES = [
    "Client Meeting",
    "Project Site Visit",
    "Training / Workshop",
    "Conference / Event",
    "Internal Meeting",
    "Audit / Inspection",
    "Recruitment",
    "Other",
]


def upgrade() -> None:
    op.add_column(
        "travel_requests",
        sa.Column("travel_type", sa.String(length=16), nullable=False, server_default="NON_PROJECT"),
    )
    op.add_column("travel_requests", sa.Column("project_code", sa.String(length=128), nullable=True))
    op.add_column(
        "travel_requests",
        sa.Column("needs_additional_booking", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("travel_requests", sa.Column("additional_booking_details", sa.Text(), nullable=True))

    options = op.create_table(
        "travel_request_options",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("option_type", sa.String(length=24), nullable=False),
        sa.Column("value", sa.String(length=128), nullable=False),
        sa.Column("label", sa.String(length=255), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("option_type", "value", name="uq_travel_request_options_type_value"),
    )
    op.create_index("ix_travel_request_options_option_type", "travel_request_options", ["option_type"])
    # Project codes are company-specific so none are seeded; admins add them in Admin → Travel Options.
    op.bulk_insert(
        options,
        [
            {"option_type": "TRIP_PURPOSE", "value": name, "label": name, "is_active": True}
            for name in _DEFAULT_PURPOSES
        ],
    )

    op.create_table(
        "travel_request_supporting_documents",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "travel_request_id",
            sa.Integer(),
            sa.ForeignKey("travel_requests.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("uploaded_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("file_sha256", sa.String(length=64), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("storage_path", sa.String(length=512), nullable=False),
        sa.Column("content_type", sa.String(length=128), nullable=False),
        sa.Column("file_size_bytes", sa.Integer(), nullable=False),
        sa.Column("description", sa.String(length=255), nullable=True),
        sa.Column("uploaded_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index(
        "ix_travel_request_supporting_documents_travel_request_id",
        "travel_request_supporting_documents",
        ["travel_request_id"],
    )
    op.create_index(
        "ix_travel_request_supporting_documents_uploaded_by_user_id",
        "travel_request_supporting_documents",
        ["uploaded_by_user_id"],
    )


def downgrade() -> None:
    op.drop_table("travel_request_supporting_documents")
    op.drop_index("ix_travel_request_options_option_type", table_name="travel_request_options")
    op.drop_table("travel_request_options")
    op.drop_column("travel_requests", "additional_booking_details")
    op.drop_column("travel_requests", "needs_additional_booking")
    op.drop_column("travel_requests", "project_code")
    op.drop_column("travel_requests", "travel_type")
