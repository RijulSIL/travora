"""relocation requests — approval prerequisite for relocation reimbursement claims

- relocation_requests / relocation_approval_stages: an employee's relocation approval, either
  requested through the Relocation Approval workflow or self-declared with uploaded evidence.
- claim_drafts.relocation_request_id / undertaking_accepted_at / undertaking_text: which approved
  relocation a claim is raised against, and the undertaking accepted at submit.
- Seeds the "Relocation" trip purpose (the Travel Claim form's entry point into this flow).

Revision ID: f4c1a7e2b905
Revises: e3b7d2a94c18
Create Date: 2026-10-14
"""

import sqlalchemy as sa

from alembic import op

revision = "f4c1a7e2b905"
down_revision = "e3b7d2a94c18"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "relocation_requests",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("employee_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("origin_city", sa.String(length=128), nullable=False),
        sa.Column("destination_city", sa.String(length=128), nullable=False),
        sa.Column("estimated_amount", sa.Numeric(12, 2), nullable=True),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column("evidence_path", sa.String(length=512), nullable=True),
        sa.Column("evidence_filename", sa.String(length=255), nullable=True),
        sa.Column("evidence_content_type", sa.String(length=128), nullable=True),
        sa.Column("current_approval_stage", sa.Integer(), nullable=True),
        sa.Column("rejection_reason", sa.Text(), nullable=True),
        sa.Column("decided_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_relocation_requests_employee_user_id", "relocation_requests", ["employee_user_id"])

    op.create_table(
        "relocation_approval_stages",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "relocation_request_id",
            sa.Integer(),
            sa.ForeignKey("relocation_requests.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("stage_number", sa.Integer(), nullable=False),
        sa.Column("stage_label", sa.String(length=128), nullable=False),
        sa.Column("required_role", sa.String(length=64), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("sla_deadline_at", sa.DateTime(), nullable=True),
        sa.Column("last_notified_at", sa.DateTime(), nullable=True),
        sa.Column("sla_breached_at", sa.DateTime(), nullable=True),
        sa.Column("decided_at", sa.DateTime(), nullable=True),
        sa.Column("decided_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("comment", sa.Text(), nullable=True),
    )
    op.create_index(
        "ix_relocation_approval_stages_relocation_request_id", "relocation_approval_stages", ["relocation_request_id"]
    )
    op.create_index("ix_relocation_approval_stages_required_role", "relocation_approval_stages", ["required_role"])

    op.add_column("claim_drafts", sa.Column("relocation_request_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_claim_drafts_relocation_request", "claim_drafts", "relocation_requests", ["relocation_request_id"], ["id"]
    )
    op.create_index("ix_claim_drafts_relocation_request_id", "claim_drafts", ["relocation_request_id"])
    op.add_column("claim_drafts", sa.Column("undertaking_accepted_at", sa.DateTime(), nullable=True))
    op.add_column("claim_drafts", sa.Column("undertaking_text", sa.Text(), nullable=True))

    op.execute(
        "INSERT INTO travel_request_options (option_type, value, label, is_active) "
        "SELECT 'TRIP_PURPOSE', 'Relocation', 'Relocation', 1 FROM DUAL "
        "WHERE NOT EXISTS (SELECT 1 FROM travel_request_options WHERE option_type = 'TRIP_PURPOSE' AND value = 'Relocation')"
    )


def downgrade() -> None:
    op.drop_column("claim_drafts", "undertaking_text")
    op.drop_column("claim_drafts", "undertaking_accepted_at")
    op.drop_constraint("fk_claim_drafts_relocation_request", "claim_drafts", type_="foreignkey")
    op.drop_index("ix_claim_drafts_relocation_request_id", table_name="claim_drafts")
    op.drop_column("claim_drafts", "relocation_request_id")
    op.drop_table("relocation_approval_stages")
    op.drop_table("relocation_requests")
