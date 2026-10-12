"""claim_drafts: travel_type / project_code — same admin-managed fields the Travel Request form
already has, so the Travel Claim wizard can offer the identical dropdowns instead of a free-text
Trip Purpose with no Travel Type / Project Code at all.

Revision ID: f7bd38c5c419
Revises: b45b59f1e8d9
Create Date: 2026-10-09
"""

import sqlalchemy as sa

from alembic import op

revision = "f7bd38c5c419"
down_revision = "b45b59f1e8d9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "claim_drafts",
        sa.Column("travel_type", sa.String(length=16), nullable=False, server_default="NON_PROJECT"),
    )
    op.add_column("claim_drafts", sa.Column("project_code", sa.String(length=128), nullable=True))


def downgrade() -> None:
    op.drop_column("claim_drafts", "project_code")
    op.drop_column("claim_drafts", "travel_type")
