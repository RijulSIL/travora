"""add payment proof columns to invoices

Revision ID: b7d3e9f1a2c4
Revises: a4b8e2f6c9d1
Create Date: 2026-09-25 00:00:00.000001

"""
import sqlalchemy as sa
from alembic import op

revision = "b7d3e9f1a2c4"
down_revision = "a4b8e2f6c9d1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("invoices", sa.Column("payment_proof_storage_path", sa.String(length=512), nullable=True))
    op.add_column("invoices", sa.Column("payment_proof_original_filename", sa.String(length=255), nullable=True))
    op.add_column("invoices", sa.Column("payment_proof_content_type", sa.String(length=128), nullable=True))
    op.add_column("invoices", sa.Column("payment_proof_file_size_bytes", sa.Integer(), nullable=True))
    op.add_column("invoices", sa.Column("payment_proof_uploaded_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("invoices", "payment_proof_uploaded_at")
    op.drop_column("invoices", "payment_proof_file_size_bytes")
    op.drop_column("invoices", "payment_proof_content_type")
    op.drop_column("invoices", "payment_proof_original_filename")
    op.drop_column("invoices", "payment_proof_storage_path")
