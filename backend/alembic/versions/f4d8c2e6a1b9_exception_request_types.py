"""add exception_requests.exception_types

Revision ID: f4d8c2e6a1b9
Revises: e7c4a1f9b3d2
Create Date: 2026-09-15 00:00:00.000000

"""
import sqlalchemy as sa
from alembic import op

revision = "f4d8c2e6a1b9"
down_revision = "e7c4a1f9b3d2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "exception_requests",
        sa.Column("exception_types", sa.JSON(), nullable=True),
    )
    # Backfill existing rows from the single exception_type they already carry.
    op.execute(
        "UPDATE exception_requests SET exception_types = JSON_ARRAY(exception_type) "
        "WHERE exception_types IS NULL"
    )
    op.alter_column("exception_requests", "exception_types", nullable=False)


def downgrade() -> None:
    op.drop_column("exception_requests", "exception_types")
