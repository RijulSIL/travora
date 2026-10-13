"""claim exceptions raised on submit — per-expense type, amount snapshot

Claim exception requests are now created only when the employee submits the claim (one per
flagged expense, with the reason they typed in the submit modal), and run in parallel with the
claim's normal approval instead of holding it in PENDING_EXCEPTION.

- claim_expenses.exception_type stores the type _build_claim_expenses decided on, so submit and
  every later read use the same value instead of re-deriving it from the category name.
- exception_requests.expense_category_name / claimed_amount record which expense a request was
  raised for and its amount, so an approved exception is reused on resubmission (after a
  send-back) only while that expense's amount is unchanged.

Claims already sitting in PENDING_EXCEPTION are left as they are: they finish through the old
path (approval chain starts once all their exceptions are approved).

Revision ID: b5e2c8a91d37
Revises: d48ccfa4a140
Create Date: 2026-10-12
"""

import sqlalchemy as sa

from alembic import op

revision = "b5e2c8a91d37"
down_revision = "d48ccfa4a140"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("claim_expenses", sa.Column("exception_type", sa.String(length=128), nullable=True))
    op.add_column("exception_requests", sa.Column("expense_category_name", sa.String(length=128), nullable=True))
    op.add_column("exception_requests", sa.Column("claimed_amount", sa.Numeric(12, 2), nullable=True))


def downgrade() -> None:
    op.drop_column("exception_requests", "claimed_amount")
    op.drop_column("exception_requests", "expense_category_name")
    op.drop_column("claim_expenses", "exception_type")
