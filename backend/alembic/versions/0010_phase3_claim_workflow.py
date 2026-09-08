"""phase 3 claim lifecycle and workflow

Revision ID: 0010_phase3_claim_workflow
Revises: 0009_invoice_uploader_file_sha_unique
Create Date: 2026-04-27
"""

import json

import sqlalchemy as sa
from alembic import op

revision = "0010_phase3_claim_workflow"
down_revision = "0009_invoice_uploader_file_sha_unique"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    if dialect == "mysql":
        op.execute(
            """
            ALTER TABLE claim_drafts MODIFY COLUMN status ENUM(
                'DRAFT','SUBMITTED','IN_APPROVAL','READY_FOR_PAYMENT',
                'SENT_BACK','REJECTED','ON_HOLD','PAID'
            ) NOT NULL
            """
        )
    else:
        pass

    op.add_column("claim_drafts", sa.Column("claim_reference", sa.String(length=32), nullable=True))
    op.add_column("claim_drafts", sa.Column("current_approval_stage", sa.Integer(), nullable=True))
    op.add_column("claim_drafts", sa.Column("approved_amount", sa.Numeric(12, 2), nullable=True))
    op.add_column("claim_drafts", sa.Column("payment_utr", sa.String(length=128), nullable=True))
    op.add_column("claim_drafts", sa.Column("payment_amount", sa.Numeric(12, 2), nullable=True))
    op.add_column("claim_drafts", sa.Column("payment_recorded_at", sa.DateTime(), nullable=True))
    op.add_column("claim_drafts", sa.Column("payment_recorded_by", sa.Integer(), nullable=True))
    op.add_column("claim_drafts", sa.Column("reject_reason", sa.Text(), nullable=True))
    op.create_index("ix_claim_drafts_claim_reference", "claim_drafts", ["claim_reference"])
    op.create_foreign_key(
        "fk_claim_drafts_payment_recorded_by",
        "claim_drafts",
        "users",
        ["payment_recorded_by"],
        ["id"],
    )

    op.create_table(
        "claim_approval_stages",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("claim_id", sa.Integer(), nullable=False),
        sa.Column("stage_number", sa.Integer(), nullable=False),
        sa.Column("stage_label", sa.String(length=128), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("sla_deadline_at", sa.DateTime(), nullable=True),
        sa.Column("decided_at", sa.DateTime(), nullable=True),
        sa.Column("decided_by_user_id", sa.Integer(), nullable=True),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["claim_id"], ["claim_drafts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["decided_by_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_claim_approval_stages_claim_id", "claim_approval_stages", ["claim_id"])

    op.create_table(
        "advance_requests",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("employee_user_id", sa.Integer(), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("purpose", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["employee_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_advance_requests_employee_user_id", "advance_requests", ["employee_user_id"])

    op.create_table(
        "advance_approval_stages",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("advance_id", sa.Integer(), nullable=False),
        sa.Column("stage_number", sa.Integer(), nullable=False),
        sa.Column("stage_label", sa.String(length=128), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("sla_deadline_at", sa.DateTime(), nullable=True),
        sa.Column("decided_at", sa.DateTime(), nullable=True),
        sa.Column("decided_by_user_id", sa.Integer(), nullable=True),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["advance_id"], ["advance_requests.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["decided_by_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_advance_approval_stages_advance_id", "advance_approval_stages", ["advance_id"])

    op.create_table(
        "exception_requests",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("claim_id", sa.Integer(), nullable=False),
        sa.Column("requested_by_user_id", sa.Integer(), nullable=False),
        sa.Column("exception_type", sa.String(length=128), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("decided_at", sa.DateTime(), nullable=True),
        sa.Column("decided_by_user_id", sa.Integer(), nullable=True),
        sa.Column("decision_comment", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["claim_id"], ["claim_drafts.id"]),
        sa.ForeignKeyConstraint(["decided_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["requested_by_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_exception_requests_claim_id", "exception_requests", ["claim_id"])

    op.create_table(
        "workflow_config",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("config_json", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_by_user_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "notification_templates",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("template_key", sa.String(length=64), nullable=False),
        sa.Column("channel", sa.String(length=32), nullable=False),
        sa.Column("subject", sa.String(length=255), nullable=False),
        sa.Column("body_text", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("template_key"),
    )
    op.create_index("ix_notification_templates_template_key", "notification_templates", ["template_key"])

    default_config = {
        "stages": [
            {"number": 1, "label": "Manager Review", "sla_hours": 48},
            {"number": 2, "label": "HR/HRBP Review", "sla_hours": 48},
            {"number": 3, "label": "Payroll Review", "sla_hours": 48},
            {"number": 4, "label": "Finance / Payment", "sla_hours": 240},
        ],
        "submission": {
            "max_working_days_after_return": 5,
            "deadline_mode": "hard_block",
        },
        "auto_approve_below_amount": "2000.00",
    }
    conn = op.get_bind()
    cfg_str = json.dumps(default_config)
    if dialect == "mysql":
        conn.execute(
            sa.text("INSERT INTO workflow_config (id, config_json) VALUES (1, CAST(:j AS JSON))"),
            {"j": cfg_str},
        )
    else:
        wf_tbl = sa.table("workflow_config", sa.column("id", sa.Integer), sa.column("config_json", sa.JSON))
        conn.execute(sa.insert(wf_tbl).values(id=1, config_json=default_config))

    templates = [
        (
            "claim_submitted",
            "Claim {{claim_id}} submitted",
            "Hello {{employee_name}}, claim {{claim_id}} for amount {{amount}} is submitted. Deadline {{deadline}}.",
        ),
        (
            "payment_confirmed",
            "Payment for claim {{claim_id}}",
            "Hello {{employee_name}}, payment of {{amount}} for claim {{claim_id}} was recorded. UTR: {{utr_reference}}.",
        ),
    ]
    for idx, (key, subj, body) in enumerate(templates, start=1):
        conn.execute(
            sa.text(
                "INSERT INTO notification_templates (id, template_key, channel, subject, body_text) "
                "VALUES (:id, :template_key, 'EMAIL', :subject, :body_text)"
            ),
            {"id": idx, "template_key": key, "subject": subj, "body_text": body},
        )


def downgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    op.execute(sa.text("DELETE FROM notification_templates"))
    op.execute(sa.text("DELETE FROM workflow_config"))

    op.drop_index("ix_notification_templates_template_key", table_name="notification_templates")
    op.drop_table("notification_templates")

    op.drop_table("workflow_config")

    op.drop_index("ix_exception_requests_claim_id", table_name="exception_requests")
    op.drop_table("exception_requests")

    op.drop_index("ix_advance_approval_stages_advance_id", table_name="advance_approval_stages")
    op.drop_table("advance_approval_stages")

    op.drop_index("ix_advance_requests_employee_user_id", table_name="advance_requests")
    op.drop_table("advance_requests")

    op.drop_index("ix_claim_approval_stages_claim_id", table_name="claim_approval_stages")
    op.drop_table("claim_approval_stages")

    op.drop_constraint("fk_claim_drafts_payment_recorded_by", "claim_drafts", type_="foreignkey")
    op.drop_index("ix_claim_drafts_claim_reference", table_name="claim_drafts")
    op.drop_column("claim_drafts", "reject_reason")
    op.drop_column("claim_drafts", "payment_recorded_by")
    op.drop_column("claim_drafts", "payment_recorded_at")
    op.drop_column("claim_drafts", "payment_amount")
    op.drop_column("claim_drafts", "payment_utr")
    op.drop_column("claim_drafts", "approved_amount")
    op.drop_column("claim_drafts", "current_approval_stage")
    op.drop_column("claim_drafts", "claim_reference")

    if dialect == "mysql":
        op.execute(
            """
            ALTER TABLE claim_drafts MODIFY COLUMN status ENUM(
                'DRAFT','SUBMITTED'
            ) NOT NULL
            """
        )