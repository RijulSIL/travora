"""Travel policy defaults, applied: b7d2e4f9a1c3 checked for the seed script's placeholder values,
but databases get theirs from migrations 0002-0014 (0007's room rent is hard-block from Level 5B,
not from Level 4A as in the seed script), so it found a difference and left them alone. This
runs the same change with that check widened to accept either placeholder.

The policy data and the steps are b7d2e4f9a1c3's own (loaded from that file, which never
changes). Still only done when version 1 holds nothing but placeholder values; anything an admin
has changed is left alone.

Revision ID: c4e9a2d6f8b1
Revises: b7d2e4f9a1c3
Create Date: 2026-11-23
"""

import importlib.util
from pathlib import Path

import sqlalchemy as sa

from alembic import op

revision = "c4e9a2d6f8b1"
down_revision = "b7d2e4f9a1c3"
branch_labels = None
depends_on = None

_spec = importlib.util.spec_from_file_location(
    "_travel_policy_b7d2e4f9a1c3", Path(__file__).with_name("b7d2e4f9a1c3_sil_domestic_travel_policy.py")
)
policy = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(policy)


def _placeholder_limit_variants(level_id: int, group: str) -> list[tuple]:
    """The seed script's limit row, and the same with 0007's room-rent hard block (Level id 9 up)."""
    seed = policy._seed_limit(level_id, group)
    return [seed, (seed[0], level_id >= 9, *seed[2:])]


def _still_placeholder(conn) -> bool:
    versions = conn.execute(sa.text("SELECT id, version_number, effective_from FROM policy_versions")).all()
    if [(v.id, v.version_number, str(v.effective_from)) for v in versions] != [(1, "1.0", policy.SEED_EFFECTIVE_FROM)]:
        return False
    levels = conn.execute(
        sa.text("SELECT id, level_code FROM impact_levels WHERE policy_version_id = 1 ORDER BY id")
    ).all()
    if [(row.id, row.level_code) for row in levels] != list(enumerate(policy.SEED_LEVELS, start=1)):
        return False
    limits = conn.execute(
        sa.text(
            "SELECT impact_level_id, city_group, hotel_cap, hotel_is_hard_block, food_cap, food_is_hard_block, "
            "incidental_cap, incidental_is_hard_block, day_visit_cap, day_visit_is_hard_block "
            "FROM expense_limits WHERE policy_version_id = 1"
        )
    ).all()
    if len(limits) != len(policy.SEED_LEVELS) * 3:
        return False
    for row in limits:
        if row.impact_level_id not in range(1, len(policy.SEED_LEVELS) + 1):
            return False
        if row.city_group not in policy.SEED_GROUP_MULTIPLIER:
            return False
        actual = (
            policy._money(row.hotel_cap), bool(row.hotel_is_hard_block),
            policy._money(row.food_cap), bool(row.food_is_hard_block),
            policy._money(row.incidental_cap), bool(row.incidental_is_hard_block),
            policy._money(row.day_visit_cap), bool(row.day_visit_is_hard_block),
        )
        if actual not in _placeholder_limit_variants(row.impact_level_id, row.city_group):
            return False
    categories = conn.execute(
        sa.text("SELECT id, name FROM expense_categories WHERE policy_version_id = 1 ORDER BY id")
    ).all()
    return [(row.id, row.name) for row in categories] == list(enumerate(policy.SEED_CATEGORIES, start=1))


def apply(conn) -> bool:
    if not _still_placeholder(conn):
        return False
    conn.execute(
        sa.text("UPDATE policy_versions SET effective_from = :start WHERE id = 1"), {"start": policy.EFFECTIVE_FROM}
    )
    policy._apply_limits(conn, policy._apply_levels(conn))
    policy._apply_categories(conn)
    policy._apply_cities(conn)
    return True


def upgrade() -> None:
    if not apply(op.get_bind()):
        print(
            "Travel policy defaults: policy version 1 isn't the placeholder anymore (or there's no policy yet), "
            "so it was left as it is."
        )


def downgrade() -> None:
    # Data only: the policy values stay (they're changed in Policy Administration).
    pass
