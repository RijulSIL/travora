"""seed corrections

Revision ID: 0007_seed_corrections
Revises: 0006_model_corrections
Create Date: 2026-04-27
"""

from datetime import date

import sqlalchemy as sa
from alembic import op

revision = "0007_seed_corrections"
down_revision = "0006_model_corrections"
branch_labels = None
depends_on = None


LEVELS = [
    (1, "L1", "CXO / Director", "YES", "BUSINESS", False, 28, 10, 12000),
    (2, "L2", "VP / Senior Director", "YES", "PREMIUM_ECONOMY", False, 26, 9, 10000),
    (3, "L3A", "Senior Manager", "CONDITIONAL", "ECONOMY", False, 24, 8, 8500),
    (4, "L3B", "Manager", "CONDITIONAL", "ECONOMY", False, 23, 8, 7500),
    (5, "L4A", "Deputy Manager", "CONDITIONAL", "ECONOMY", False, 22, 7, 6500),
    (6, "L4B", "Assistant Manager", "CONDITIONAL", "ECONOMY", False, 21, 7, 5500),
    (7, "L4C", "Senior Executive", "NO", None, False, 20, 6, 4500),
    (8, "L5A", "Executive", "NO", None, False, 19, 6, 3500),
    (9, "L5B", "Senior Associate", "NO", None, True, 18, 5, 3200),
    (10, "L6A", "Associate I", "NO", None, True, 18, 5, 2800),
    (11, "L6B", "Associate II", "NO", None, True, 17, 5, 2500),
    (12, "L6C", "Associate III", "NO", None, True, 17, 5, 2300),
    (13, "L6D", "Trainee", "NO", None, True, 16, 4, 2200),
]

OLD_LEVELS = [
    (1, "L1", "SIL L1", "YES", False, 28, 10, 9000),
    (2, "L2", "SIL L2", "YES", False, 26, 9, 8000),
    (3, "L3", "SIL L3", "CONDITIONAL", False, 24, 8, 6500),
    (4, "L4", "SIL L4", "CONDITIONAL", True, 22, 7, 5000),
    (5, "L5", "SIL L5", "NO", True, 20, 6, 3500),
    (6, "L6A", "SIL L6A", "NO", True, 18, 5, 2800),
    (7, "L6B", "SIL L6B", "NO", True, 18, 5, 2500),
    (8, "L6D", "SIL L6D", "NO", True, 16, 4, 2200),
]


def _execute(statement: str, **params: object) -> None:
    op.get_bind().execute(sa.text(statement), params)


def _execute_json(statement: str, **params: object) -> None:
    bindparams = []
    if ":conditions" in statement:
        bindparams.append(sa.bindparam("conditions", type_=sa.JSON))
    if ":train_classes" in statement:
        bindparams.append(sa.bindparam("train_classes", type_=sa.JSON))
    if ":conveyance_modes" in statement:
        bindparams.append(sa.bindparam("conveyance_modes", type_=sa.JSON))
    typed = sa.text(statement).bindparams(*bindparams)
    op.get_bind().execute(typed, params)


def _scalar(statement: str, **params: object) -> int:
    value = op.get_bind().scalar(sa.text(statement), params)
    return int(value or 0)


def _upsert_level(
    *,
    level_id: int,
    code: str,
    name: str,
    air: str,
    air_class: str | None,
    twin: bool,
    rate_4w: int,
    rate_2w: int,
) -> None:
    exists = _scalar("SELECT COUNT(*) FROM impact_levels WHERE id = :id", id=level_id)
    params = {
        "id": level_id,
        "code": code,
        "name": name,
        "air": air,
        "air_class": air_class,
        "rate_4w": rate_4w,
        "rate_2w": rate_2w,
        "twin": twin,
    }
    if exists:
        _execute_json(
            """
            UPDATE impact_levels
            SET level_code = :code,
                level_name = :name,
                air_eligibility = :air,
                air_class_allowed = :air_class,
                air_eligibility_conditions = :conditions,
                vehicle_rate_4w = :rate_4w,
                vehicle_rate_2w = :rate_2w,
                twin_sharing_mandatory = :twin,
                is_deprecated = false
            WHERE id = :id
            """,
            **{**params, "conditions": {"approval_required": air == "CONDITIONAL"}},
        )
        return

    _execute_json(
        """
        INSERT INTO impact_levels (
            id, level_code, level_name, air_eligibility, air_class_allowed,
            air_eligibility_conditions, train_classes_allowed, local_conveyance_modes,
            vehicle_rate_4w, vehicle_rate_2w, twin_sharing_mandatory, is_deprecated,
            policy_version_id
        )
        VALUES (
            :id, :code, :name, :air, :air_class, :conditions, :train_classes,
            :conveyance_modes, :rate_4w, :rate_2w, :twin, false, 1
        )
        """,
        **{
            **params,
            "conditions": {"approval_required": air == "CONDITIONAL"},
            "train_classes": ["1A", "2A", "3A", "CC"] if level_id <= 4 else ["3A", "CC", "SL"],
            "conveyance_modes": ["Own Vehicle 4W", "Own Vehicle 2W", "Hired Taxi", "Auto/Cab"],
        },
    )


def _upsert_limit(level_id: int, group: str, base: int) -> None:
    multiplier = {"A": 1.0, "B": 0.8, "C": 0.65}[group]
    params = {
        "policy_version_id": 1,
        "impact_level_id": level_id,
        "city_group": group,
        "hotel_cap": int(base * multiplier),
        "hotel_hard": level_id >= 9,
        "food_cap": int(base * multiplier * 0.35),
        "incidental_cap": int(base * multiplier * 0.15),
        "day_visit_cap": int(base * multiplier * 0.25),
        "day_visit_hard": level_id >= 10,
    }
    exists = _scalar(
        """
        SELECT COUNT(*) FROM expense_limits
        WHERE policy_version_id = :policy_version_id
          AND impact_level_id = :impact_level_id
          AND city_group = :city_group
        """,
        **params,
    )
    if exists:
        _execute(
            """
            UPDATE expense_limits
            SET hotel_cap = :hotel_cap,
                hotel_is_hard_block = :hotel_hard,
                food_cap = :food_cap,
                food_is_hard_block = false,
                incidental_cap = :incidental_cap,
                incidental_is_hard_block = false,
                day_visit_cap = :day_visit_cap,
                day_visit_is_hard_block = :day_visit_hard
            WHERE policy_version_id = :policy_version_id
              AND impact_level_id = :impact_level_id
              AND city_group = :city_group
            """,
            **params,
        )
        return

    _execute(
        """
        INSERT INTO expense_limits (
            policy_version_id, impact_level_id, city_group, hotel_cap,
            hotel_is_hard_block, food_cap, food_is_hard_block, incidental_cap,
            incidental_is_hard_block, day_visit_cap, day_visit_is_hard_block
        )
        VALUES (
            :policy_version_id, :impact_level_id, :city_group, :hotel_cap,
            :hotel_hard, :food_cap, false, :incidental_cap, false, :day_visit_cap,
            :day_visit_hard
        )
        """,
        **params,
    )


def upgrade() -> None:
    for level_id, code, name, air, air_class, twin, rate_4w, rate_2w, base in LEVELS:
        _upsert_level(
            level_id=level_id,
            code=code,
            name=name,
            air=air,
            air_class=air_class,
            twin=twin,
            rate_4w=rate_4w,
            rate_2w=rate_2w,
        )
        for group in ("A", "B", "C"):
            _upsert_limit(level_id, group, base)

    _execute("UPDATE city_groups SET group_type = 'A' WHERE city_name = 'Ahmedabad'")


def downgrade() -> None:
    _execute("DELETE FROM expense_limits WHERE impact_level_id > 8")
    _execute("DELETE FROM impact_levels WHERE id > 8")
    _execute("UPDATE city_groups SET group_type = 'B' WHERE city_name = 'Ahmedabad'")

    for level_id, code, name, air, twin, rate_4w, rate_2w, base in OLD_LEVELS:
        _execute_json(
            """
            UPDATE impact_levels
            SET level_code = :code,
                level_name = :name,
                air_eligibility = :air,
                air_class_allowed = NULL,
                air_eligibility_conditions = :conditions,
                vehicle_rate_4w = :rate_4w,
                vehicle_rate_2w = :rate_2w,
                twin_sharing_mandatory = :twin,
                is_deprecated = false
            WHERE id = :id
            """,
            id=level_id,
            code=code,
            name=name,
            air=air,
            conditions={"approval_required": air == "CONDITIONAL"},
            rate_4w=rate_4w,
            rate_2w=rate_2w,
            twin=twin,
        )
        for group in ("A", "B", "C"):
            _upsert_limit(level_id, group, base)
