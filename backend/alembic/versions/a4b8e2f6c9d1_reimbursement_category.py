"""add reimbursement_category to claim_drafts and invoices

Revision ID: a4b8e2f6c9d1
Revises: f1a2b3c4d5e6
Create Date: 2026-09-25 00:00:00.000000

"""
import sqlalchemy as sa
from alembic import op

revision = "a4b8e2f6c9d1"
down_revision = "f1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "claim_drafts",
        sa.Column("reimbursement_category", sa.String(length=32), nullable=False, server_default="TRAVEL"),
    )
    op.create_index(
        "ix_claim_drafts_reimbursement_category", "claim_drafts", ["reimbursement_category"]
    )
    op.add_column(
        "invoices",
        sa.Column("reimbursement_category", sa.String(length=32), nullable=False, server_default="TRAVEL"),
    )
    op.create_index("ix_invoices_reimbursement_category", "invoices", ["reimbursement_category"])


def downgrade() -> None:
    op.drop_index("ix_invoices_reimbursement_category", table_name="invoices")
    op.drop_column("invoices", "reimbursement_category")
    op.drop_index("ix_claim_drafts_reimbursement_category", table_name="claim_drafts")
    op.drop_column("claim_drafts", "reimbursement_category")
