"""rename the REALLOCATION reimbursement category to RELOCATION

The category was always meant to be Relocation (moving to a new posting), not Reallocation.
reimbursement_category is a plain VARCHAR (non-native enum), so this is a data-only rename on
invoices and claim_drafts, plus the Approval Matrix's per-category stage override key if an
admin ever configured one for it.

Revision ID: c9a4e1f7b2d6
Revises: b5e2c8a91d37
Create Date: 2026-10-13
"""

import json

import sqlalchemy as sa

from alembic import op

revision = "c9a4e1f7b2d6"
down_revision = "b5e2c8a91d37"
branch_labels = None
depends_on = None


def _rename(old: str, new: str) -> None:
    conn = op.get_bind()
    for table in ("invoices", "claim_drafts"):
        conn.execute(
            sa.text(f"UPDATE {table} SET reimbursement_category = :new WHERE reimbursement_category = :old"),
            {"new": new, "old": old},
        )
    row = conn.execute(sa.text("SELECT id, config_json FROM workflow_config WHERE id = 1")).first()
    if row is None or row.config_json is None:
        return
    config = row.config_json if isinstance(row.config_json, dict) else json.loads(row.config_json)
    overrides = config.get("category_overrides") or {}
    if old in overrides:
        overrides[new] = overrides.pop(old)
        config["category_overrides"] = overrides
        conn.execute(
            sa.text("UPDATE workflow_config SET config_json = :cfg WHERE id = 1"),
            {"cfg": json.dumps(config)},
        )


def upgrade() -> None:
    _rename("REALLOCATION", "RELOCATION")


def downgrade() -> None:
    _rename("RELOCATION", "REALLOCATION")
