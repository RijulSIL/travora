"""phase 2 invoices and claims

Revision ID: 0008_phase2_invoices_claims
Revises: 0007_seed_corrections
Create Date: 2026-04-27
"""

import sqlalchemy as sa
from alembic import op

revision = "0008_phase2_invoices_claims"
down_revision = "0007_seed_corrections"
branch_labels = None
depends_on = None


invoice_status = sa.Enum(
    "PROCESSING", "READY_FOR_REVIEW", "REVIEWED", "ERROR", name="invoicestatus"
)
gstin_validation_status = sa.Enum("VALID", "INVALID", "PENDING", name="gstinvalidationstatus")
claim_status = sa.Enum("DRAFT", "SUBMITTED", name="claimstatus")


def upgrade() -> None:
    bind = op.get_bind()
    invoice_status.create(bind, checkfirst=True)
    gstin_validation_status.create(bind, checkfirst=True)
    claim_status.create(bind, checkfirst=True)

    op.create_table(
        "invoices",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("uploader_user_id", sa.Integer(), nullable=False),
        sa.Column("file_sha256", sa.String(length=64), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("content_type", sa.String(length=128), nullable=False),
        sa.Column("file_size_bytes", sa.Integer(), nullable=False),
        sa.Column("storage_path", sa.String(length=512), nullable=False),
        sa.Column("status", invoice_status, nullable=False),
        sa.Column("extraction_error", sa.Text(), nullable=True),
        sa.Column("duplicate_invoice_id", sa.Integer(), nullable=True),
        sa.Column("duplicate_acknowledged", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("gstin_validation_status", gstin_validation_status, nullable=True),
        sa.Column("gstin_validation_checked_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["duplicate_invoice_id"], ["invoices.id"]),
        sa.ForeignKeyConstraint(["uploader_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("uploader_user_id", "file_sha256", name="uq_invoices_uploader_file_sha"),
    )
    op.create_index("ix_invoices_file_sha256", "invoices", ["file_sha256"])
    op.create_index("ix_invoices_status", "invoices", ["status"])
    op.create_index("ix_invoices_uploader_user_id", "invoices", ["uploader_user_id"])
    op.create_index("ix_invoices_duplicate_invoice_id", "invoices", ["duplicate_invoice_id"])

    op.create_table(
        "invoice_fields",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("invoice_id", sa.Integer(), nullable=False),
        sa.Column("field_key", sa.String(length=64), nullable=False),
        sa.Column("original_value", sa.Text(), nullable=True),
        sa.Column("confidence", sa.Numeric(5, 2), nullable=False),
        sa.Column("final_value", sa.Text(), nullable=True),
        sa.Column("confirmed_at", sa.DateTime(), nullable=True),
        sa.Column("confirmed_by", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["confirmed_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["invoice_id"], ["invoices.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_invoice_fields_invoice_id", "invoice_fields", ["invoice_id"])
    op.create_index("ix_invoice_fields_field_key", "invoice_fields", ["field_key"])

    op.create_table(
        "invoice_line_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("invoice_id", sa.Integer(), nullable=False),
        sa.Column("description", sa.String(length=255), nullable=False),
        sa.Column("quantity", sa.Numeric(10, 2), nullable=True),
        sa.Column("unit", sa.String(length=32), nullable=True),
        sa.Column("unit_price", sa.Numeric(12, 2), nullable=True),
        sa.Column("taxable_value", sa.Numeric(12, 2), nullable=False),
        sa.Column("tax_rate", sa.Numeric(5, 2), nullable=True),
        sa.Column("cgst", sa.Numeric(12, 2), nullable=False),
        sa.Column("sgst", sa.Numeric(12, 2), nullable=False),
        sa.Column("igst", sa.Numeric(12, 2), nullable=False),
        sa.Column("total_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("category_id", sa.Integer(), nullable=True),
        sa.Column("category_name", sa.String(length=128), nullable=True),
        sa.Column("is_blacklisted", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.ForeignKeyConstraint(["category_id"], ["expense_categories.id"]),
        sa.ForeignKeyConstraint(["invoice_id"], ["invoices.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_invoice_line_items_invoice_id", "invoice_line_items", ["invoice_id"])
    op.create_index("ix_invoice_line_items_category_id", "invoice_line_items", ["category_id"])

    op.create_table(
        "gstin_validation_cache",
        sa.Column("gstin", sa.String(length=15), nullable=False),
        sa.Column("status", gstin_validation_status, nullable=False),
        sa.Column("legal_name", sa.String(length=255), nullable=True),
        sa.Column("raw_response", sa.JSON(), nullable=True),
        sa.Column("checked_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("gstin"),
    )

    op.create_table(
        "claim_drafts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("employee_user_id", sa.Integer(), nullable=False),
        sa.Column("employee_id", sa.String(length=64), nullable=True),
        sa.Column("trip_purpose", sa.String(length=255), nullable=True),
        sa.Column("departure_date", sa.Date(), nullable=True),
        sa.Column("return_date", sa.Date(), nullable=True),
        sa.Column("office_location", sa.String(length=255), nullable=True),
        sa.Column("destination_city", sa.String(length=128), nullable=True),
        sa.Column("destination_city_group", sa.Enum("A", "B", "C", name="citygrouptype"), nullable=True),
        sa.Column("advance_received", sa.Numeric(12, 2), nullable=False),
        sa.Column("status", claim_status, nullable=False),
        sa.Column("compliance_report", sa.JSON(), nullable=True),
        sa.Column("submitted_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.employee_id"]),
        sa.ForeignKeyConstraint(["employee_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_claim_drafts_employee_user_id", "claim_drafts", ["employee_user_id"])
    op.create_index("ix_claim_drafts_employee_id", "claim_drafts", ["employee_id"])
    op.create_index("ix_claim_drafts_destination_city", "claim_drafts", ["destination_city"])

    op.create_table(
        "claim_invoices",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("claim_id", sa.Integer(), nullable=False),
        sa.Column("invoice_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["claim_id"], ["claim_drafts.id"]),
        sa.ForeignKeyConstraint(["invoice_id"], ["invoices.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_claim_invoices_claim_id", "claim_invoices", ["claim_id"])
    op.create_index("ix_claim_invoices_invoice_id", "claim_invoices", ["invoice_id"])

    op.create_table(
        "claim_expenses",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("claim_id", sa.Integer(), nullable=False),
        sa.Column("expense_category_id", sa.Integer(), nullable=True),
        sa.Column("category_name", sa.String(length=128), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("cap_amount", sa.Numeric(12, 2), nullable=True),
        sa.Column("policy_status", sa.String(length=32), nullable=False),
        sa.Column("exception_requested", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.ForeignKeyConstraint(["claim_id"], ["claim_drafts.id"]),
        sa.ForeignKeyConstraint(["expense_category_id"], ["expense_categories.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_claim_expenses_claim_id", "claim_expenses", ["claim_id"])


def downgrade() -> None:
    op.drop_index("ix_claim_expenses_claim_id", table_name="claim_expenses")
    op.drop_table("claim_expenses")
    op.drop_index("ix_claim_invoices_invoice_id", table_name="claim_invoices")
    op.drop_index("ix_claim_invoices_claim_id", table_name="claim_invoices")
    op.drop_table("claim_invoices")
    op.drop_index("ix_claim_drafts_destination_city", table_name="claim_drafts")
    op.drop_index("ix_claim_drafts_employee_id", table_name="claim_drafts")
    op.drop_index("ix_claim_drafts_employee_user_id", table_name="claim_drafts")
    op.drop_table("claim_drafts")
    op.drop_table("gstin_validation_cache")
    op.drop_index("ix_invoice_line_items_category_id", table_name="invoice_line_items")
    op.drop_index("ix_invoice_line_items_invoice_id", table_name="invoice_line_items")
    op.drop_table("invoice_line_items")
    op.drop_index("ix_invoice_fields_field_key", table_name="invoice_fields")
    op.drop_index("ix_invoice_fields_invoice_id", table_name="invoice_fields")
    op.drop_table("invoice_fields")
    op.drop_index("ix_invoices_duplicate_invoice_id", table_name="invoices")
    op.drop_index("ix_invoices_uploader_user_id", table_name="invoices")
    op.drop_index("ix_invoices_status", table_name="invoices")
    op.drop_index("ix_invoices_file_sha256", table_name="invoices")
    op.drop_table("invoices")

    bind = op.get_bind()
    claim_status.drop(bind, checkfirst=True)
    gstin_validation_status.drop(bind, checkfirst=True)
    invoice_status.drop(bind, checkfirst=True)
