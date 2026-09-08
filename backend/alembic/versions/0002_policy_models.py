"""policy models and initial policy seed

Revision ID: 0002_policy_models
Revises: 0001_empty_baseline
Create Date: 2026-04-27
"""

from datetime import date

import sqlalchemy as sa
from alembic import op

revision = "0002_policy_models"
down_revision = "0001_empty_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "policy_versions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("version_number", sa.String(length=32), nullable=False, unique=True),
        sa.Column("effective_from", sa.Date(), nullable=False),
        sa.Column("effective_to", sa.Date(), nullable=True),
        sa.Column(
            "status",
            sa.Enum("DRAFT", "PENDING_HRBP", "ACTIVE", "ARCHIVED", name="policystatus"),
            nullable=False,
        ),
        sa.Column("approved_by", sa.Integer(), nullable=True),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_table(
        "impact_levels",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("level_code", sa.String(length=32), nullable=False, index=True),
        sa.Column("level_name", sa.String(length=128), nullable=False),
        sa.Column(
            "air_eligibility",
            sa.Enum("YES", "NO", "CONDITIONAL", name="aireligibility"),
            nullable=False,
        ),
        sa.Column(
            "air_class_allowed",
            sa.Enum("ECONOMY", "PREMIUM_ECONOMY", "BUSINESS", name="airclass"),
            nullable=True,
        ),
        sa.Column("air_eligibility_conditions", sa.JSON(), nullable=True),
        sa.Column("train_classes_allowed", sa.JSON(), nullable=True),
        sa.Column("local_conveyance_modes", sa.JSON(), nullable=True),
        sa.Column("vehicle_rate_4w", sa.Numeric(10, 2), nullable=True),
        sa.Column("vehicle_rate_2w", sa.Numeric(10, 2), nullable=True),
        sa.Column("twin_sharing_mandatory", sa.Boolean(), nullable=False, default=False),
        sa.Column("is_deprecated", sa.Boolean(), nullable=False, default=False),
        sa.Column("policy_version_id", sa.Integer(), sa.ForeignKey("policy_versions.id"), nullable=False),
    )
    op.create_table(
        "city_groups",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("city_name", sa.String(length=128), nullable=False, index=True),
        sa.Column("group_type", sa.Enum("A", "B", "C", name="citygrouptype"), nullable=False),
        sa.Column("effective_from", sa.Date(), nullable=False),
        sa.Column("effective_to", sa.Date(), nullable=True),
    )
    op.create_table(
        "expense_limits",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("policy_version_id", sa.Integer(), sa.ForeignKey("policy_versions.id"), nullable=False),
        sa.Column("impact_level_id", sa.Integer(), sa.ForeignKey("impact_levels.id"), nullable=False),
        sa.Column("city_group", sa.Enum("A", "B", "C", name="expensecitygrouptype"), nullable=False),
        sa.Column("hotel_cap", sa.Numeric(12, 2), nullable=True),
        sa.Column("hotel_is_hard_block", sa.Boolean(), nullable=False, default=False),
        sa.Column("food_cap", sa.Numeric(12, 2), nullable=True),
        sa.Column("food_is_hard_block", sa.Boolean(), nullable=False, default=False),
        sa.Column("incidental_cap", sa.Numeric(12, 2), nullable=True),
        sa.Column("incidental_is_hard_block", sa.Boolean(), nullable=False, default=False),
        sa.Column("day_visit_cap", sa.Numeric(12, 2), nullable=True),
        sa.Column("day_visit_is_hard_block", sa.Boolean(), nullable=False, default=False),
    )

    bind = op.get_bind()
    if bind.scalar(sa.text("SELECT COUNT(*) FROM policy_versions")):
        return

    policy_table = sa.table(
        "policy_versions",
        sa.column("id", sa.Integer()),
        sa.column("version_number", sa.String()),
        sa.column("effective_from", sa.Date()),
        sa.column("effective_to", sa.Date()),
        sa.column("status", sa.String()),
    )
    op.bulk_insert(
        policy_table,
        [{"id": 1, "version_number": "1.0", "effective_from": date(2026, 4, 27), "effective_to": None, "status": "ACTIVE"}],
    )

    impact_table = sa.table(
        "impact_levels",
        sa.column("id", sa.Integer()),
        sa.column("level_code", sa.String()),
        sa.column("level_name", sa.String()),
        sa.column("air_eligibility", sa.String()),
        sa.column("air_class_allowed", sa.String()),
        sa.column("air_eligibility_conditions", sa.JSON()),
        sa.column("train_classes_allowed", sa.JSON()),
        sa.column("local_conveyance_modes", sa.JSON()),
        sa.column("vehicle_rate_4w", sa.Numeric()),
        sa.column("vehicle_rate_2w", sa.Numeric()),
        sa.column("twin_sharing_mandatory", sa.Boolean()),
        sa.column("is_deprecated", sa.Boolean()),
        sa.column("policy_version_id", sa.Integer()),
    )
    levels = [
        (1, "L1", "CXO / Director", "YES", "BUSINESS", False, 28, 10),
        (2, "L2", "VP / Senior Director", "YES", "PREMIUM_ECONOMY", False, 26, 9),
        (3, "L3A", "Senior Manager", "CONDITIONAL", "ECONOMY", False, 24, 8),
        (4, "L3B", "Manager", "CONDITIONAL", "ECONOMY", False, 23, 8),
        (5, "L4A", "Deputy Manager", "CONDITIONAL", "ECONOMY", False, 22, 7),
        (6, "L4B", "Assistant Manager", "CONDITIONAL", "ECONOMY", False, 21, 7),
        (7, "L4C", "Senior Executive", "NO", None, False, 20, 6),
        (8, "L5A", "Executive", "NO", None, False, 19, 6),
        (9, "L5B", "Senior Associate", "NO", None, True, 18, 5),
        (10, "L6A", "Associate I", "NO", None, True, 18, 5),
        (11, "L6B", "Associate II", "NO", None, True, 17, 5),
        (12, "L6C", "Associate III", "NO", None, True, 17, 5),
        (13, "L6D", "Trainee", "NO", None, True, 16, 4),
    ]
    op.bulk_insert(
        impact_table,
        [
            {
                "id": level_id,
                "level_code": code,
                "level_name": name,
                "air_eligibility": air,
                "air_class_allowed": air_class,
                "air_eligibility_conditions": {"approval_required": air == "CONDITIONAL"},
                "train_classes_allowed": ["1A", "2A", "3A", "CC"] if level_id <= 4 else ["3A", "CC", "SL"],
                "local_conveyance_modes": ["Own Vehicle 4W", "Own Vehicle 2W", "Hired Taxi", "Auto/Cab"],
                "vehicle_rate_4w": four_w,
                "vehicle_rate_2w": two_w,
                "twin_sharing_mandatory": twin,
                "is_deprecated": False,
                "policy_version_id": 1,
            }
            for level_id, code, name, air, air_class, twin, four_w, two_w in levels
        ],
    )

    city_table = sa.table(
        "city_groups",
        sa.column("id", sa.Integer()),
        sa.column("city_name", sa.String()),
        sa.column("group_type", sa.String()),
        sa.column("effective_from", sa.Date()),
        sa.column("effective_to", sa.Date()),
    )
    cities = [
        ("Bengaluru", "A"),
        ("Chennai", "A"),
        ("Delhi NCR", "A"),
        ("Hyderabad", "A"),
        ("Kolkata", "A"),
        ("Mumbai", "A"),
        ("Pune", "A"),
        ("Ahmedabad", "A"),
        ("Chandigarh", "B"),
        ("Coimbatore", "B"),
        ("Indore", "B"),
        ("Jaipur", "B"),
        ("Kochi", "B"),
        ("Lucknow", "B"),
    ]
    op.bulk_insert(
        city_table,
        [
            {"id": index + 1, "city_name": city, "group_type": group, "effective_from": date(2026, 4, 27), "effective_to": None}
            for index, (city, group) in enumerate(cities)
        ],
    )

    limit_table = sa.table(
        "expense_limits",
        sa.column("policy_version_id", sa.Integer()),
        sa.column("impact_level_id", sa.Integer()),
        sa.column("city_group", sa.String()),
        sa.column("hotel_cap", sa.Numeric()),
        sa.column("hotel_is_hard_block", sa.Boolean()),
        sa.column("food_cap", sa.Numeric()),
        sa.column("food_is_hard_block", sa.Boolean()),
        sa.column("incidental_cap", sa.Numeric()),
        sa.column("incidental_is_hard_block", sa.Boolean()),
        sa.column("day_visit_cap", sa.Numeric()),
        sa.column("day_visit_is_hard_block", sa.Boolean()),
    )
    group_multiplier = {"A": 1.0, "B": 0.8, "C": 0.65}
    base_by_level = {
        1: 12000,
        2: 10000,
        3: 8500,
        4: 7500,
        5: 6500,
        6: 5500,
        7: 4500,
        8: 3500,
        9: 3200,
        10: 2800,
        11: 2500,
        12: 2300,
        13: 2200,
    }
    op.bulk_insert(
        limit_table,
        [
            {
                "policy_version_id": 1,
                "impact_level_id": level_id,
                "city_group": group,
                "hotel_cap": int(base * group_multiplier[group]),
                "hotel_is_hard_block": level_id >= 5,
                "food_cap": int(base * group_multiplier[group] * 0.35),
                "food_is_hard_block": False,
                "incidental_cap": int(base * group_multiplier[group] * 0.15),
                "incidental_is_hard_block": False,
                "day_visit_cap": int(base * group_multiplier[group] * 0.25),
                "day_visit_is_hard_block": level_id >= 10,
            }
            for level_id, base in base_by_level.items()
            for group in ("A", "B", "C")
        ],
    )


def downgrade() -> None:
    op.drop_table("expense_limits")
    op.drop_table("city_groups")
    op.drop_table("impact_levels")
    op.drop_table("policy_versions")
