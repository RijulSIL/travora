"""claim exception shell flag

Revision ID: a3f7d9c1e5b2
Revises: f4d8c2e6a1b9
Create Date: 2026-09-16 00:00:00.000000

"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "a3f7d9c1e5b2"
down_revision = "f4d8c2e6a1b9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "claim_drafts",
        sa.Column("is_exception_shell", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    # Backfill pre-existing shells created before this flag existed (identifiable by the
    # fixed placeholder trip_purpose set in POST /exceptions/request).
    op.execute(
        "UPDATE claim_drafts SET is_exception_shell = TRUE "
        "WHERE trip_purpose LIKE 'Auto-generated Shell for Travel Booking Exception%'"
    )
    op.alter_column("claim_drafts", "is_exception_shell", server_default=None)


def downgrade() -> None:
    op.drop_column("claim_drafts", "is_exception_shell")
