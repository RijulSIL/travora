"""relocation — an approval the employee already has needs no check in the app

The "Relocation prior-approval check" (Approval Matrix) is gone: an uploaded approval is approved
straight away. Uploads still waiting on that check are approved now, their check steps removed,
and the setting is dropped from the saved workflow config.

Revision ID: e7b3c1d9a5f2
Revises: d4f0a7e2c6b8
Create Date: 2026-10-30
"""

import json

import sqlalchemy as sa

from alembic import op

revision = "e7b3c1d9a5f2"
down_revision = "d4f0a7e2c6b8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        sa.text(
            "DELETE FROM relocation_approval_stages WHERE relocation_request_id IN "
            "(SELECT id FROM relocation_requests WHERE source = 'PRIOR_APPROVAL')"
        )
    )
    conn.execute(
        sa.text(
            "UPDATE relocation_requests SET status = 'APPROVED', current_approval_stage = NULL, "
            "decided_at = COALESCE(decided_at, CURRENT_TIMESTAMP) "
            "WHERE source = 'PRIOR_APPROVAL' AND status = 'PENDING'"
        )
    )

    row = conn.execute(sa.text("SELECT id, config_json FROM workflow_config WHERE id = 1")).first()
    if row is None or row.config_json is None:
        return
    config = row.config_json if isinstance(row.config_json, dict) else json.loads(row.config_json)
    overrides = config.get("category_overrides")
    if isinstance(overrides, dict) and "RELOCATION_PRIOR_APPROVAL" in overrides:
        del overrides["RELOCATION_PRIOR_APPROVAL"]
        conn.execute(
            sa.text("UPDATE workflow_config SET config_json = :cfg WHERE id = 1"),
            {"cfg": json.dumps(config)},
        )


def downgrade() -> None:
    # Approvals made by this upgrade aren't undone: those uploads may already have claims on them.
    pass
