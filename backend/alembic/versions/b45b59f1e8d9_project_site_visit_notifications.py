"""project site-visit stakeholder notifications

Adds notify_project_stakeholders to travel_request_options (meaningful on TRIP_PURPOSE rows —
default-enabled on the seeded "Project Site Visit" purpose so the feature works out of the box),
the project_notification_recipients table (admin-managed, any number of plain email addresses
per project_code, no account required), and a new "project_site_visit" EMAIL template row so the
notice's wording is admin-editable through the existing Notification Templates screen.

Revision ID: b45b59f1e8d9
Revises: 7a1c5e9d3b20
Create Date: 2026-10-09
"""

import sqlalchemy as sa

from alembic import op

revision = "b45b59f1e8d9"
down_revision = "7a1c5e9d3b20"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "travel_request_options",
        sa.Column("notify_project_stakeholders", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.execute(
        "UPDATE travel_request_options SET notify_project_stakeholders = TRUE "
        "WHERE option_type = 'TRIP_PURPOSE' AND value = 'Project Site Visit'"
    )

    op.create_table(
        "project_notification_recipients",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("project_code", sa.String(length=128), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index(
        "ix_project_notification_recipients_project_code",
        "project_notification_recipients",
        ["project_code"],
    )

    conn = op.get_bind()
    existing = conn.execute(
        sa.text("SELECT id FROM notification_templates WHERE template_key = 'project_site_visit'")
    ).first()
    if existing is None:
        conn.execute(
            sa.text(
                "INSERT INTO notification_templates (template_key, channel, subject, body_text) "
                "VALUES ('project_site_visit', 'EMAIL', :subject, :body_text)"
            ),
            {
                "subject": "Upcoming site visit — {{project_code}}",
                "body_text": (
                    "{{employee_name}} is visiting {{to_city}} for project {{project_code}} "
                    "from {{start_date}} to {{end_date}}.\n\nPurpose: {{purpose}}"
                ),
            },
        )


def downgrade() -> None:
    op.execute("DELETE FROM notification_templates WHERE template_key = 'project_site_visit'")
    op.drop_index("ix_project_notification_recipients_project_code", table_name="project_notification_recipients")
    op.drop_table("project_notification_recipients")
    op.drop_column("travel_request_options", "notify_project_stakeholders")
