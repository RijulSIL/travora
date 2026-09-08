"""phase5 finance reporting and immutable audit

Revision ID: 0013_phase5_finance_reporting_audit
Revises: 0012_exception_chain_and_claim_trips
Create Date: 2026-04-27
"""

import sqlalchemy as sa
from alembic import op

revision = "0013_phase5_finance_reporting_audit"
down_revision = "0012_exception_chain_and_claim_trips"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("audit_logs", sa.Column("previous_event_hash", sa.String(length=64), nullable=True))
    op.add_column("audit_logs", sa.Column("event_hash", sa.String(length=64), nullable=True))
    op.create_index("ix_audit_logs_previous_event_hash", "audit_logs", ["previous_event_hash"])
    op.create_index("ix_audit_logs_event_hash", "audit_logs", ["event_hash"])
    op.execute("UPDATE audit_logs SET event_hash = CONCAT('legacy-', id) WHERE event_hash IS NULL")
    op.alter_column("audit_logs", "event_hash", existing_type=sa.String(length=64), nullable=False)

    op.create_table(
        "erp_ledger_entries",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("claim_id", sa.Integer(), nullable=False),
        sa.Column("employee_id", sa.String(length=64), nullable=True),
        sa.Column("cost_centre", sa.String(length=128), nullable=True),
        sa.Column("expense_category_breakdown", sa.JSON(), nullable=True),
        sa.Column("taxable_value", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("cgst", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("sgst", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("igst", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("payment_reference", sa.String(length=128), nullable=False),
        sa.Column("payment_date", sa.DateTime(), nullable=False),
        sa.Column("erp_system", sa.String(length=64), nullable=True),
        sa.Column("erp_entry_id", sa.String(length=128), nullable=True),
        sa.Column(
            "status",
            sa.Enum("POSTED", "FAILED", "PENDING", name="erppoststatus"),
            nullable=False,
        ),
        sa.Column("failure_reason", sa.Text(), nullable=True),
        sa.Column("posted_by_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.ForeignKeyConstraint(["claim_id"], ["claim_drafts.id"]),
        sa.ForeignKeyConstraint(["posted_by_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("claim_id", name="uq_erp_ledger_entries_claim_id"),
    )
    op.create_index("ix_erp_ledger_entries_claim_id", "erp_ledger_entries", ["claim_id"])
    op.create_index("ix_erp_ledger_entries_cost_centre", "erp_ledger_entries", ["cost_centre"])
    op.create_index("ix_erp_ledger_entries_employee_id", "erp_ledger_entries", ["employee_id"])
    op.create_index("ix_erp_ledger_entries_erp_entry_id", "erp_ledger_entries", ["erp_entry_id"])
    op.create_index("ix_erp_ledger_entries_payment_reference", "erp_ledger_entries", ["payment_reference"])
    op.create_index("ix_erp_ledger_entries_status", "erp_ledger_entries", ["status"])

    op.create_table(
        "scheduled_reports",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("report_type", sa.String(length=64), nullable=False),
        sa.Column("report_format", sa.Enum("PDF", "EXCEL", "CSV", name="reportformat"), nullable=False),
        sa.Column(
            "frequency",
            sa.Enum("DAILY", "WEEKLY", "MONTHLY", name="schedulefrequency"),
            nullable=False,
        ),
        sa.Column("recipients", sa.JSON(), nullable=False),
        sa.Column("filters", sa.JSON(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("last_run_at", sa.DateTime(), nullable=True),
        sa.Column("next_run_at", sa.DateTime(), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_scheduled_reports_frequency", "scheduled_reports", ["frequency"])
    op.create_index("ix_scheduled_reports_report_format", "scheduled_reports", ["report_format"])
    op.create_index("ix_scheduled_reports_report_type", "scheduled_reports", ["report_type"])


def downgrade() -> None:
    op.drop_index("ix_scheduled_reports_report_type", table_name="scheduled_reports")
    op.drop_index("ix_scheduled_reports_report_format", table_name="scheduled_reports")
    op.drop_index("ix_scheduled_reports_frequency", table_name="scheduled_reports")
    op.drop_table("scheduled_reports")

    op.drop_index("ix_erp_ledger_entries_status", table_name="erp_ledger_entries")
    op.drop_index("ix_erp_ledger_entries_payment_reference", table_name="erp_ledger_entries")
    op.drop_index("ix_erp_ledger_entries_erp_entry_id", table_name="erp_ledger_entries")
    op.drop_index("ix_erp_ledger_entries_employee_id", table_name="erp_ledger_entries")
    op.drop_index("ix_erp_ledger_entries_cost_centre", table_name="erp_ledger_entries")
    op.drop_index("ix_erp_ledger_entries_claim_id", table_name="erp_ledger_entries")
    op.drop_table("erp_ledger_entries")

    op.drop_index("ix_audit_logs_event_hash", table_name="audit_logs")
    op.drop_index("ix_audit_logs_previous_event_hash", table_name="audit_logs")
    op.drop_column("audit_logs", "event_hash")
    op.drop_column("audit_logs", "previous_event_hash")
