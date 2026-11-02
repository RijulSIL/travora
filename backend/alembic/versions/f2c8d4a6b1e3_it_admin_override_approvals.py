"""role permissions — give IT Admin the new "override_approvals" permission

A saved Role permissions config replaces each role's code defaults wholesale (a new permission
never reaches a role an admin has already customised — see permission_config_service), so IT
Admin gets it here, as asked. Admins can still take it away in Role permissions.

Revision ID: f2c8d4a6b1e3
Revises: e7b3c1d9a5f2
Create Date: 2026-10-30
"""

import json

import sqlalchemy as sa

from alembic import op

revision = "f2c8d4a6b1e3"
down_revision = "e7b3c1d9a5f2"
branch_labels = None
depends_on = None

PERMISSION = "override_approvals"


def _update(add: bool) -> None:
    conn = op.get_bind()
    row = conn.execute(sa.text("SELECT id, config_json FROM role_permission_config WHERE id = 1")).first()
    if row is None or row.config_json is None:
        return  # no saved config: the code defaults (which include it) apply
    config = row.config_json if isinstance(row.config_json, dict) else json.loads(row.config_json)
    perms = list((config.get("permissions") or {}).get("IT_ADMIN") or [])
    if add and PERMISSION not in perms:
        perms.append(PERMISSION)
    elif not add and PERMISSION in perms:
        perms.remove(PERMISSION)
    else:
        return
    config.setdefault("permissions", {})["IT_ADMIN"] = perms
    conn.execute(
        sa.text("UPDATE role_permission_config SET config_json = :cfg WHERE id = 1"), {"cfg": json.dumps(config)}
    )


def upgrade() -> None:
    _update(add=True)


def downgrade() -> None:
    _update(add=False)
