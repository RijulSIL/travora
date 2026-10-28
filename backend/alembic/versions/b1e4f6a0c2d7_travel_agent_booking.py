"""travel agent booking — "Send to agent" public ticketing link

- travel_requests.agent_token / agent_sent_at / agent_sent_by_user_id: a single-use random link
  the Travel Desk emails to the company's travel agent for a request (see
  travel_request_service.send_travel_request_to_agent). Overwritten on every resend, so an older
  emailed link stops resolving the moment a new one is sent.
- company_profile.travel_agent_email: the one address "Send to agent" emails.

Purely additive: new nullable columns and a unique index, no data rewrites.

Revision ID: b1e4f6a0c2d7
Revises: a3f7c9e1d5b2
Create Date: 2026-10-28
"""

import sqlalchemy as sa

from alembic import op

revision = "b1e4f6a0c2d7"
down_revision = "a3f7c9e1d5b2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("travel_requests", sa.Column("agent_token", sa.String(length=64), nullable=True))
    op.add_column("travel_requests", sa.Column("agent_sent_at", sa.DateTime(), nullable=True))
    op.add_column(
        "travel_requests",
        sa.Column("agent_sent_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    )
    op.create_index(
        "ix_travel_requests_agent_token", "travel_requests", ["agent_token"], unique=True
    )
    op.add_column("company_profile", sa.Column("travel_agent_email", sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column("company_profile", "travel_agent_email")
    op.drop_index("ix_travel_requests_agent_token", table_name="travel_requests")
    # MySQL auto-names the FK this inline sa.ForeignKey() created; drop it by its column
    # instead of guessing the name (see a6c3e8f2b4d1's downgrade for the same pattern).
    inspector = sa.inspect(op.get_bind())
    for fk in inspector.get_foreign_keys("travel_requests"):
        if fk["constrained_columns"] == ["agent_sent_by_user_id"]:
            op.drop_constraint(fk["name"], "travel_requests", type_="foreignkey")
    op.drop_column("travel_requests", "agent_sent_by_user_id")
    op.drop_column("travel_requests", "agent_sent_at")
    op.drop_column("travel_requests", "agent_token")
