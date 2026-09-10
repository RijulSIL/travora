"""allow exception_requests to link to a travel request instead of a claim

Revision ID: a2c9e4b71f30
Revises: f1b3d8a6c2e0
Create Date: 2026-09-10 00:00:00.000000

"""
import sqlalchemy as sa
from alembic import op

revision = "a2c9e4b71f30"
down_revision = "f1b3d8a6c2e0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "exception_requests",
        "claim_id",
        existing_type=sa.Integer(),
        nullable=True,
    )
    op.add_column(
        "exception_requests",
        sa.Column("travel_request_id", sa.Integer(), nullable=True),
    )
    op.create_index(
        "ix_exception_requests_travel_request_id",
        "exception_requests",
        ["travel_request_id"],
    )
    op.create_foreign_key(
        "fk_exception_requests_travel_request_id",
        "exception_requests",
        "travel_requests",
        ["travel_request_id"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint("fk_exception_requests_travel_request_id", "exception_requests", type_="foreignkey")
    op.drop_index("ix_exception_requests_travel_request_id", table_name="exception_requests")
    op.drop_column("exception_requests", "travel_request_id")
    op.alter_column(
        "exception_requests",
        "claim_id",
        existing_type=sa.Integer(),
        nullable=False,
    )
