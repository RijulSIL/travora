"""Payment proof is no longer needed: drop its columns from invoices

The proof files and these columns' values were backed up before this ran. The downgrade puts
the columns back, empty.

Revision ID: f2b6d9a4c7e1
Revises: e8a2c5f1d7b3
Create Date: 2026-10-23
"""

import sqlalchemy as sa

from alembic import op

revision = "f2b6d9a4c7e1"
down_revision = "e8a2c5f1d7b3"
branch_labels = None
depends_on = None

_COLUMNS = [
    "payment_proof_uploaded_at",
    "payment_proof_file_size_bytes",
    "payment_proof_content_type",
    "payment_proof_original_filename",
    "payment_proof_storage_path",
]


def upgrade() -> None:
    for column in _COLUMNS:
        op.drop_column("invoices", column)


def downgrade() -> None:
    op.add_column("invoices", sa.Column("payment_proof_storage_path", sa.String(length=512), nullable=True))
    op.add_column("invoices", sa.Column("payment_proof_original_filename", sa.String(length=255), nullable=True))
    op.add_column("invoices", sa.Column("payment_proof_content_type", sa.String(length=128), nullable=True))
    op.add_column("invoices", sa.Column("payment_proof_file_size_bytes", sa.Integer(), nullable=True))
    op.add_column("invoices", sa.Column("payment_proof_uploaded_at", sa.DateTime(), nullable=True))
