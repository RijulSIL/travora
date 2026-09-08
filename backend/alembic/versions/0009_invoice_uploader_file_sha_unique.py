"""invoice file hash unique per uploader

Revision ID: 0009_invoice_uploader_file_sha_unique
Revises: 0008_phase2_invoices_claims
Create Date: 2026-04-27
"""

import sqlalchemy as sa
from alembic import op

revision = "0009_invoice_uploader_file_sha_unique"
down_revision = "0008_phase2_invoices_claims"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    uks = inspector.get_unique_constraints("invoices")
    for uk in uks:
        cols = tuple(uk.get("column_names") or ())
        if cols == ("file_sha256",):
            op.drop_constraint(uk["name"], "invoices", type_="unique")
    inspector = sa.inspect(bind)
    uks_after = {tuple(u["column_names"] or ()) for u in inspector.get_unique_constraints("invoices")}
    if ("uploader_user_id", "file_sha256") not in uks_after:
        op.create_unique_constraint(
            "uq_invoices_uploader_file_sha",
            "invoices",
            ["uploader_user_id", "file_sha256"],
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    for uk in inspector.get_unique_constraints("invoices"):
        if uk["name"] == "uq_invoices_uploader_file_sha":
            op.drop_constraint("uq_invoices_uploader_file_sha", "invoices", type_="unique")
            break
    inspector = sa.inspect(bind)
    uks_after = {tuple(u["column_names"] or ()) for u in inspector.get_unique_constraints("invoices")}
    if ("file_sha256",) not in uks_after:
        op.create_unique_constraint("uq_invoices_file_sha256_global", "invoices", ["file_sha256"])
