"""company_profile.departments — the company's department list (Company profile page)

Starts with the 11 departments the app used to offer, plus any department someone is already in
that isn't one of them (matched ignoring capitals and spaces).

Revision ID: c7d2e9a4b1f8
Revises: b4e8d1c7a2f6
Create Date: 2026-10-21
"""

import json
import re

import sqlalchemy as sa

from alembic import op

revision = "c7d2e9a4b1f8"
down_revision = "b4e8d1c7a2f6"
branch_labels = None
depends_on = None

DEFAULT_DEPARTMENTS = [
    "Engineering",
    "Human Resources",
    "Finance",
    "Sales",
    "Marketing",
    "Operations",
    "IT",
    "Legal",
    "Customer Support",
    "Design",
    "Product",
]


def _key(name: str) -> str:
    return re.sub(r"\s+", " ", (name or "").strip()).lower()


def upgrade() -> None:
    op.add_column("company_profile", sa.Column("departments", sa.JSON(), nullable=True))
    conn = op.get_bind()
    departments = list(DEFAULT_DEPARTMENTS)
    seen = {_key(d) for d in departments}
    in_use = conn.execute(sa.text("SELECT DISTINCT department FROM employees WHERE department IS NOT NULL")).scalars()
    for name in sorted(n for n in in_use if n and n.strip()):
        cleaned = re.sub(r"\s+", " ", name.strip())
        if _key(cleaned) not in seen:
            seen.add(_key(cleaned))
            departments.append(cleaned)
    conn.execute(sa.text("UPDATE company_profile SET departments = :d"), {"d": json.dumps(departments)})


def downgrade() -> None:
    op.drop_column("company_profile", "departments")
