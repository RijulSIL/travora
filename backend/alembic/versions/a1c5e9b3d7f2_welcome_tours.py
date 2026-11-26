# ruff: noqa: E501 — the template text below keeps its own line breaks.
"""Welcome tours: which ones each person has seen

users.tours_seen: {tour key: "finished" | "skipped" | "existing"} for the short guided tours on
Home (onboarding_tour_service). A tour not in it starts by itself the next time the person opens
Home.

People who were already using Travora (they've set their own password) are marked as having
seen the tours for their role today ("existing"), so only new people get one by themselves;
everyone can still take any of their tours from the account menu. A later role change or the
Manager setting being turned on still brings the new tour.

The welcome email gains a line about the tour, but only where the "user_welcome" template still
has its original text; an edited template is left alone.

Revision ID: a1c5e9b3d7f2
Revises: f2c6a8e4b1d3
Create Date: 2026-11-20
"""

import json

import sqlalchemy as sa

from alembic import op

revision = "a1c5e9b3d7f2"
down_revision = "f2c6a8e4b1d3"
branch_labels = None
depends_on = None

# A copy of onboarding_tour_service.ROLE_TOUR / tours_for as they are today (a migration keeps
# its own copy so it never changes after it has run).
ROLE_TOUR = {
    "EMPLOYEE": "employee",
    "REPORTING_MANAGER": "manager",
    "HRBP_HR": "hrbp",
    "FINANCE": "finance",
    "PAYROLL": "payroll",
    "IT_ADMIN": "admin",
    "CEO": "approver",
    "GROUP_HEAD_HR": "approver",
    "ADMIN": "approver",
    "RECRUITER": "recruiter",
}
MANAGER_ROLES = {"CEO", "REPORTING_MANAGER"}


def tours_for(role: str, manager_setting: bool) -> list[str]:
    own = ROLE_TOUR.get(role, "employee")
    if (manager_setting or role in MANAGER_ROLES) and own != "manager":
        return ["manager"] if own == "employee" else [own, "manager"]
    return [own]


OLD_BODY = """Hi {{first_name}},

Your Travora account is ready. Travora is where you raise travel requests, claim expenses and follow them through approval and payment.

Your first sign-in
1. Sign in with your email and the temporary password below.
2. Enter the code we email you.
3. Set your own password. The temporary one stops working after that.

Didn't expect this email? Contact your HR or IT team."""

NEW_BODY = """Hi {{first_name}},

Your Travora account is ready. Travora is where you raise travel requests, claim expenses and follow them through approval and payment.

Your first sign-in
1. Sign in with your email and the temporary password below.
2. Enter the code we email you.
3. Set your own password. The temporary one stops working after that.
4. Add your meal preference and ID for travel, then take a 2-minute tour of Travora.

Didn't expect this email? Contact your HR or IT team."""


def _swap_welcome_body(conn, old: str, new: str) -> None:
    row = conn.execute(sa.text("SELECT id, body_text FROM notification_templates WHERE template_key = 'user_welcome'")).first()
    if row is not None and (row.body_text or "").replace("\r\n", "\n") == old:
        conn.execute(sa.text("UPDATE notification_templates SET body_text = :body WHERE id = :id"), {"body": new, "id": row.id})


def upgrade() -> None:
    op.add_column("users", sa.Column("tours_seen", sa.JSON(), nullable=True))
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, role, is_manager FROM users WHERE must_change_password = 0")).all()
    for row in rows:
        seen = {tour: "existing" for tour in tours_for(str(row.role), bool(row.is_manager))}
        conn.execute(sa.text("UPDATE users SET tours_seen = :seen WHERE id = :id"), {"seen": json.dumps(seen), "id": row.id})
    _swap_welcome_body(conn, OLD_BODY, NEW_BODY)


def downgrade() -> None:
    _swap_welcome_body(op.get_bind(), NEW_BODY, OLD_BODY)
    op.drop_column("users", "tours_seen")
