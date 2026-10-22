# ruff: noqa: E501 — the template text below keeps its own line breaks.
"""Welcome email for new users, and a must-change password at their first sign-in

users.must_change_password: set for people added from now on (they start with the temporary
password). users.welcome_email_sent_at: when their welcome email last went out. Existing users are
untouched (0 / NULL). Adds the editable "user_welcome" notification template.

Revision ID: d3f6a8c1e2b9
Revises: c7d2e9a4b1f8
Create Date: 2026-10-21
"""

import sqlalchemy as sa

from alembic import op

revision = "d3f6a8c1e2b9"
down_revision = "c7d2e9a4b1f8"
branch_labels = None
depends_on = None

SUBJECT = "Welcome to Travora, {{first_name}}"
BODY = """Hi {{first_name}},

Your Travora account is ready. Travora is where you raise travel requests, claim expenses and follow them through approval and payment.

Your first sign-in
1. Sign in with your email and the temporary password below.
2. Enter the code we email you.
3. Set your own password. The temporary one stops working after that.

Didn't expect this email? Contact your HR or IT team."""


def upgrade() -> None:
    op.add_column("users", sa.Column("must_change_password", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("users", sa.Column("welcome_email_sent_at", sa.DateTime(), nullable=True))
    conn = op.get_bind()
    exists = conn.execute(sa.text("SELECT id FROM notification_templates WHERE template_key = 'user_welcome'")).first()
    if not exists:
        conn.execute(
            sa.text(
                "INSERT INTO notification_templates (template_key, channel, subject, body_text) "
                "VALUES ('user_welcome', 'EMAIL', :subject, :body)"
            ),
            {"subject": SUBJECT, "body": BODY},
        )


def downgrade() -> None:
    op.execute("DELETE FROM notification_templates WHERE template_key = 'user_welcome'")
    op.drop_column("users", "welcome_email_sent_at")
    op.drop_column("users", "must_change_password")
