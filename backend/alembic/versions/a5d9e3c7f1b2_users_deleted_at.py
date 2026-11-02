"""users.deleted_at — a deleted user kept (anonymised) because records still point at them

Revision ID: a5d9e3c7f1b2
Revises: f2c8d4a6b1e3
Create Date: 2026-10-30
"""

import sqlalchemy as sa

from alembic import op

revision = "a5d9e3c7f1b2"
down_revision = "f2c8d4a6b1e3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("deleted_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "deleted_at")
