"""company holidays (IT Admin CRUD)

Revision ID: 0018_company_holidays
Revises: 0017_notifications
Create Date: 2026-05-02
"""

import sqlalchemy as sa
from alembic import op

revision = "0018_company_holidays"
down_revision = "0017_notifications"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "company_holidays",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("holiday_date", sa.Date(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("holiday_date", name="uq_company_holidays_holiday_date"),
    )


def downgrade() -> None:
    op.drop_table("company_holidays")
