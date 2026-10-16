"""refresh_tokens.rotated_at — when a refresh token was swapped for a new one

Refreshing now cancels the old refresh token. rotated_at records when that happened, so a
request carrying the just-swapped token (a page's double load in development, two tabs
refreshing at once) can still be accepted for a short grace period instead of logging the
user out — see auth_service.rotate_refresh_token. NULL for tokens that were never rotated
(including ones cancelled by logging out, which get no grace period).

Revision ID: a9c3e5f1b2d7
Revises: f4c1a7e2b905
Create Date: 2026-10-15
"""

import sqlalchemy as sa

from alembic import op

revision = "a9c3e5f1b2d7"
down_revision = "f4c1a7e2b905"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("refresh_tokens", sa.Column("rotated_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("refresh_tokens", "rotated_at")
