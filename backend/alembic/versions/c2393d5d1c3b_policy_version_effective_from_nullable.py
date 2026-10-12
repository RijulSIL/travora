"""policy_versions.effective_from becomes nullable — assigned at approval, not drafted upfront

Revision ID: c2393d5d1c3b
Revises: 2f0d35ffce3f
Create Date: 2026-10-07
"""

import sqlalchemy as sa
from alembic import op

revision = "c2393d5d1c3b"
down_revision = "2f0d35ffce3f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "policy_versions",
        "effective_from",
        existing_type=sa.Date(),
        nullable=True,
    )


def downgrade() -> None:
    # Any existing DRAFT/PENDING_HRBP rows with a null effective_from would violate the
    # restored NOT NULL constraint — back-fill them to today's date so the downgrade doesn't
    # fail outright (this is a best-effort placeholder only, consistent with how those rows
    # worked before this migration existed).
    op.execute("UPDATE policy_versions SET effective_from = CURDATE() WHERE effective_from IS NULL")
    op.alter_column(
        "policy_versions",
        "effective_from",
        existing_type=sa.Date(),
        nullable=False,
    )
