# ruff: noqa: E501 — one data row per line.
"""Travel policy defaults: SIL Interim Travel Policy - Domestic (w.e.f. 13/03/2026)

Policy version 1 was created by the seed with placeholder numbers (made-up limits and vehicle
rates, a few sample cities, Business class for Level 1). This puts the real policy in their
place: impact levels (air, train, local conveyance, twin sharing, ₹8.50 / ₹4 per km, and the
missing Level 5C), the Table 2 limits, the clause 4 city groups, and expense categories named
as in the policy. The version now starts on 13/03/2026, the policy's start date.

Only done when version 1 still holds exactly the seed's placeholder values (and is the only
version). Anything an admin has changed is left alone: enter the policy in Policy Administration
instead. Bills already read keep the category name they were filed under.

The data below is a frozen copy of app.core.policy_defaults as of this migration (a migration
keeps its own copy so it never changes after it has run; tests check the two match).

Revision ID: b7d2e4f9a1c3
Revises: a1c5e9b3d7f2
Create Date: 2026-11-23
"""

import json
from decimal import Decimal

import sqlalchemy as sa

from alembic import op

revision = "b7d2e4f9a1c3"
down_revision = "a1c5e9b3d7f2"
branch_labels = None
depends_on = None

EFFECTIVE_FROM = "2026-03-13"
VEHICLE_RATE_4W, VEHICLE_RATE_2W = "8.50", "4.00"
# ── The policy (frozen copy of app.core.policy_defaults) ──────────────────────────────────────────
# LEVELS: (code, name, air eligibility, air class, train classes, local conveyance modes, twin sharing)
# LIMITS: (level, city group, room rent/night, hard block, food/day, hard block, incidentals/night,
#          hard block, day visit/day, hard block); None = actuals (no limit)
# CATEGORIES: (name, parent, bill needed, GST invoice needed, never reimbursed, notes)
LEVELS = [
    ('L1', 'CXO / Director', 'YES', 'PREMIUM_ECONOMY', ['1A', 'EC', '2A', '3A', 'CC', 'SL'], ['Hired Taxi / Innova', 'Ride Hailing (Sedan / Premium)', 'Ride Hailing (Go) / Shared Taxi', 'Company Booked Vehicle', 'Auto Rickshaw', 'Metro / Public Transport', 'Personal Vehicle'], False),
    ('L2', 'VP / Senior Director', 'YES', 'ECONOMY', ['1A', 'EC', '2A', '3A', 'CC', 'SL'], ['Ride Hailing (Sedan / Premium)', 'Ride Hailing (Go) / Shared Taxi', 'Company Booked Vehicle', 'Auto Rickshaw', 'Metro / Public Transport', 'Personal Vehicle'], False),
    ('L3A', 'Senior Manager', 'YES', 'ECONOMY', ['1A', 'EC', '2A', '3A', 'CC', 'SL'], ['Ride Hailing (Sedan / Premium)', 'Ride Hailing (Go) / Shared Taxi', 'Company Booked Vehicle', 'Auto Rickshaw', 'Metro / Public Transport', 'Personal Vehicle'], False),
    ('L3B', 'Manager', 'YES', 'ECONOMY', ['1A', 'EC', '2A', '3A', 'CC', 'SL'], ['Ride Hailing (Sedan / Premium)', 'Ride Hailing (Go) / Shared Taxi', 'Company Booked Vehicle', 'Auto Rickshaw', 'Metro / Public Transport', 'Personal Vehicle'], False),
    ('L4A', 'Deputy Manager', 'YES', 'ECONOMY', ['2A', '3A', 'CC', 'SL'], ['Ride Hailing (Go) / Shared Taxi', 'Company Booked Vehicle', 'Auto Rickshaw', 'Metro / Public Transport', 'Personal Vehicle'], False),
    ('L4B', 'Assistant Manager', 'YES', 'ECONOMY', ['2A', '3A', 'CC', 'SL'], ['Ride Hailing (Go) / Shared Taxi', 'Company Booked Vehicle', 'Auto Rickshaw', 'Metro / Public Transport', 'Personal Vehicle'], False),
    ('L4C', 'Senior Executive', 'YES', 'ECONOMY', ['2A', '3A', 'CC', 'SL'], ['Ride Hailing (Go) / Shared Taxi', 'Company Booked Vehicle', 'Auto Rickshaw', 'Metro / Public Transport', 'Personal Vehicle'], False),
    ('L5A', 'Executive', 'CONDITIONAL', 'ECONOMY', ['2A', '3A', 'CC', 'SL'], ['Ride Hailing (Go) / Shared Taxi', 'Auto Rickshaw', 'Metro / Public Transport', 'Personal Vehicle'], False),
    ('L5B', 'Senior Associate', 'CONDITIONAL', 'ECONOMY', ['2A', '3A', 'CC', 'SL'], ['Ride Hailing (Go) / Shared Taxi', 'Auto Rickshaw', 'Metro / Public Transport', 'Personal Vehicle'], True),
    ('L5C', 'Level 5C', 'CONDITIONAL', 'ECONOMY', ['2A', '3A', 'CC', 'SL'], ['Ride Hailing (Go) / Shared Taxi', 'Auto Rickshaw', 'Metro / Public Transport', 'Personal Vehicle'], True),
    ('L6A', 'Associate I', 'CONDITIONAL', 'ECONOMY', ['3A', 'CC', 'SL'], ['Ride Hailing (Go) / Shared Taxi', 'Auto Rickshaw', 'Metro / Public Transport', 'Personal Vehicle'], True),
    ('L6B', 'Associate II', 'CONDITIONAL', 'ECONOMY', ['3A', 'CC', 'SL'], ['Ride Hailing (Go) / Shared Taxi', 'Auto Rickshaw', 'Metro / Public Transport', 'Personal Vehicle'], True),
    ('L6C', 'Associate III', 'CONDITIONAL', 'ECONOMY', ['3A', 'CC', 'SL'], ['Ride Hailing (Go) / Shared Taxi', 'Auto Rickshaw', 'Metro / Public Transport', 'Personal Vehicle'], True),
    ('L6D', 'Trainee', 'CONDITIONAL', 'ECONOMY', ['3A', 'CC', 'SL'], ['Ride Hailing (Go) / Shared Taxi', 'Auto Rickshaw', 'Metro / Public Transport', 'Personal Vehicle'], True),
]
LIMITS = [
    ('L1', 'A', None, True, None, False, 800, False, None, False),
    ('L1', 'B', None, True, None, False, 800, False, None, False),
    ('L1', 'C', None, True, None, False, 800, False, None, False),
    ('L2', 'A', 9000, True, None, False, 500, False, 400, False),
    ('L2', 'B', 8000, True, None, False, 500, False, 400, False),
    ('L2', 'C', 6000, True, None, False, 500, False, 400, False),
    ('L3A', 'A', 9000, True, None, False, 500, False, 400, False),
    ('L3A', 'B', 8000, True, None, False, 500, False, 400, False),
    ('L3A', 'C', 6000, True, None, False, 500, False, 400, False),
    ('L3B', 'A', 7000, True, None, False, 400, False, 300, False),
    ('L3B', 'B', 6000, True, None, False, 400, False, 300, False),
    ('L3B', 'C', 5000, True, None, False, 400, False, 300, False),
    ('L4A', 'A', 7000, True, None, False, 400, False, 300, False),
    ('L4A', 'B', 6000, True, None, False, 400, False, 300, False),
    ('L4A', 'C', 5000, True, None, False, 400, False, 300, False),
    ('L4B', 'A', 5000, True, 1500, False, 200, False, 250, False),
    ('L4B', 'B', 4000, True, 1200, False, 200, False, 250, False),
    ('L4B', 'C', 3000, True, 1200, False, 200, False, 250, False),
    ('L4C', 'A', 5000, True, 1500, False, 200, False, 250, False),
    ('L4C', 'B', 4000, True, 1200, False, 200, False, 250, False),
    ('L4C', 'C', 3000, True, 1200, False, 200, False, 250, False),
    ('L5A', 'A', 5000, True, 1500, False, 200, False, 250, False),
    ('L5A', 'B', 4000, True, 1200, False, 200, False, 250, False),
    ('L5A', 'C', 3000, True, 1200, False, 200, False, 250, False),
    ('L5B', 'A', 4000, True, 1000, False, 200, False, 200, False),
    ('L5B', 'B', 3500, True, 800, False, 200, False, 200, False),
    ('L5B', 'C', 3000, True, 700, False, 200, False, 200, False),
    ('L5C', 'A', 4000, True, 1000, False, 200, False, 200, False),
    ('L5C', 'B', 3500, True, 800, False, 200, False, 200, False),
    ('L5C', 'C', 3000, True, 700, False, 200, False, 200, False),
    ('L6A', 'A', 4000, True, 1000, False, 200, False, 200, False),
    ('L6A', 'B', 3500, True, 800, False, 200, False, 200, False),
    ('L6A', 'C', 3000, True, 700, False, 200, False, 200, False),
    ('L6B', 'A', 2500, True, 600, False, 100, False, 150, False),
    ('L6B', 'B', 2000, True, 600, False, 100, False, 150, False),
    ('L6B', 'C', 2000, True, 500, False, 100, False, 150, False),
    ('L6C', 'A', 2500, True, 600, False, 100, False, 150, False),
    ('L6C', 'B', 2000, True, 600, False, 100, False, 150, False),
    ('L6C', 'C', 2000, True, 500, False, 100, False, 150, False),
    ('L6D', 'A', 2000, True, 500, False, 75, False, 100, False),
    ('L6D', 'B', 1500, True, 500, False, 75, False, 100, False),
    ('L6D', 'C', 1200, True, 400, False, 75, False, 100, False),
]
CATEGORIES = [
    ('Air Travel', None, True, True, ['Business Class', 'First Class'], 'Economy; Premium Economy for Level 1. Levels 5-6 only with approval (journey over 12 hours or exigency). Book at least a week ahead. Boarding pass needed.'),
    ('Train Travel', None, True, False, [], '1AC/EC for Levels 1-3, 2AC/CC for Levels 4-5, 3AC/CC for Level 6. Ticket needed.'),
    ('Bus Travel', None, True, False, [], 'AC bus. Ticket needed.'),
    ('Local Conveyance', None, False, False, [], 'Mode by impact level; other modes need HRBP and CEO approval.'),
    ('Hired Taxi / Innova', 'Local Conveyance', True, False, [], 'Level 1.'),
    ('Ride Hailing (Sedan / Premium)', 'Local Conveyance', True, False, [], 'Uber Sedan/Premium or equivalent. Levels 1-3.'),
    ('Ride Hailing (Go) / Shared Taxi', 'Local Conveyance', True, False, [], 'Uber Go or equivalent, or a shared taxi. All levels.'),
    ('Company Booked Vehicle', 'Local Conveyance', False, False, [], 'Levels 1-4.'),
    ('Auto Rickshaw', 'Local Conveyance', False, False, [], 'Uber Auto or equivalent. No bill needed; fare must be less than a non-AC taxi.'),
    ('Metro / Public Transport', 'Local Conveyance', False, False, [], 'No bill needed for metro; fare must be less than a non-AC taxi.'),
    ('Personal Vehicle', 'Local Conveyance', False, False, [], "₹8.50/km four-wheeler, ₹4/km two-wheeler, with the reporting manager's prior approval."),
    ('Hotel Room Rent (incl. Laundry)', None, True, True, ['Alcohol', 'Liquor', 'Cigarette', 'Tobacco'], 'Per night, before taxes, including laundry. Stay in a company guest house where available (then only food and incidentals are paid).'),
    ('Food & Meals', None, True, False, ['Alcohol', 'Liquor', 'Cigarette', 'Tobacco'], 'Per day, before taxes. Outstation travel with an overnight stay only. Food without a bill and kaccha bills go under Incidental Expenses.'),
    ('Incidental Expenses', None, False, False, ['Alcohol', 'Liquor', 'Cigarette', 'Tobacco'], 'Per night, all locations. Includes food without a bill and kaccha bills.'),
    ('Day Visit Expenses', None, False, False, ['Alcohol', 'Liquor', 'Cigarette', 'Tobacco'], "Per day, for day visits without a night stay. External meetings need the CEO's prior approval."),
]
CITIES = {
    'A': ['Mumbai', 'Bombay', 'Thane', 'Navi Mumbai', 'Delhi NCR', 'Delhi', 'New Delhi', 'Noida', 'Greater Noida', 'Faridabad', 'Gurgaon', 'Gurugram', 'Ghaziabad', 'Kolkata', 'Calcutta', 'Chennai', 'Madras', 'Pune', 'Bangalore', 'Bengaluru', 'Hyderabad', 'Secunderabad', 'Ahmedabad'],
    'B': ['Amaravati', 'Itanagar', 'Dispur', 'Guwahati', 'Patna', 'Raipur', 'Nava Raipur', 'Panaji', 'Panjim', 'Gandhinagar', 'Chandigarh', 'Shimla', 'Ranchi', 'Thiruvananthapuram', 'Trivandrum', 'Bhopal', 'Imphal', 'Shillong', 'Aizawl', 'Kohima', 'Bhubaneswar', 'Jaipur', 'Gangtok', 'Agartala', 'Lucknow', 'Dehradun', 'Gairsain', 'Port Blair', 'Sri Vijaya Puram', 'Daman', 'Srinagar', 'Jammu', 'Leh', 'Kavaratti', 'Puducherry', 'Pondicherry', 'Goa', 'Margao', 'Madgaon', 'Vasco da Gama', 'Mapusa', 'Agra', 'Cochin', 'Kochi', 'Ernakulam', 'Calicut', 'Kozhikode', 'Coimbatore', 'Indore', 'Kanpur', 'Surat', 'Udaipur', 'Varanasi', 'Visakhapatnam', 'Vishakhapatnam', 'Vizag', 'Vijayawada', 'Vijaywada', 'Ludhiana', 'Cuttack', 'Vadodara', 'Baroda', 'Mangalore', 'Mangaluru', 'Mysore', 'Mysuru', 'Hubli', 'Hubballi', 'Belgaum', 'Belagavi', 'Nagpur', 'Aurangabad', 'Chhatrapati Sambhajinagar', 'Allahabad', 'Prayagraj', 'Gorakhpur', 'Amritsar', 'Jalandhar', 'Bareilly', 'Paradeep', 'Paradip', 'Bathinda', 'Lakhimpur', 'Lakhimpur Kheri', 'North Lakhimpur', 'Meerut'],
}

# ── What the seed put there (the only state this migration changes) ─────────────────────────────
SEED_EFFECTIVE_FROM = "2026-04-27"
SEED_LEVELS = ["L1", "L2", "L3A", "L3B", "L4A", "L4B", "L4C", "L5A", "L5B", "L6A", "L6B", "L6C", "L6D"]
SEED_LEVEL_BASE = [12000, 10000, 8500, 7500, 6500, 5500, 4500, 3500, 3200, 2800, 2500, 2300, 2200]
SEED_GROUP_MULTIPLIER = {"A": 1.0, "B": 0.8, "C": 0.65}
SEED_CATEGORIES = [
    "Air Travel", "Train Travel", "Bus Travel", "Local Conveyance", "Cab/Taxi", "Uber", "Auto", "Metro",
    "Personal Vehicle", "Hotel/Accommodation", "Food & Meals", "Breakfast", "Lunch", "Dinner",
    "Incidental Expenses", "Communication", "Day Visit Expenses",
]
SEED_CITIES = {
    ("Bengaluru", "A"), ("Chennai", "A"), ("Delhi NCR", "A"), ("Hyderabad", "A"), ("Kolkata", "A"), ("Mumbai", "A"),
    ("Pune", "A"), ("Ahmedabad", "A"), ("Chandigarh", "B"), ("Coimbatore", "B"), ("Indore", "B"), ("Jaipur", "B"),
    ("Kochi", "B"), ("Lucknow", "B"),
}
# Seed categories that become the policy's (renamed in place, so their id stays).
RENAMES = {
    "Cab/Taxi": "Hired Taxi / Innova",
    "Uber": "Ride Hailing (Sedan / Premium)",
    "Auto": "Auto Rickshaw",
    "Metro": "Metro / Public Transport",
    "Hotel/Accommodation": "Hotel Room Rent (incl. Laundry)",
}
# Not in the policy: meals aren't split, and phone bills aren't a travel expense.
DEACTIVATE = ["Breakfast", "Lunch", "Dinner", "Communication"]


def _seed_limit(level_id: int, group: str) -> tuple:
    value = SEED_LEVEL_BASE[level_id - 1] * SEED_GROUP_MULTIPLIER[group]
    return (
        Decimal(int(value)), level_id >= 5,
        Decimal(int(value * 0.35)), False,
        Decimal(int(value * 0.15)), False,
        Decimal(int(value * 0.25)), level_id >= 10,
    )


def _money(value) -> Decimal | None:
    return None if value is None else Decimal(str(value))


def _still_the_seed(conn) -> bool:
    versions = conn.execute(sa.text("SELECT id, version_number, effective_from FROM policy_versions")).all()
    if [(v.id, v.version_number, str(v.effective_from)) for v in versions] != [(1, "1.0", SEED_EFFECTIVE_FROM)]:
        return False
    levels = conn.execute(
        sa.text("SELECT id, level_code FROM impact_levels WHERE policy_version_id = 1 ORDER BY id")
    ).all()
    if [(row.id, row.level_code) for row in levels] != list(enumerate(SEED_LEVELS, start=1)):
        return False
    limits = conn.execute(
        sa.text(
            "SELECT impact_level_id, city_group, hotel_cap, hotel_is_hard_block, food_cap, food_is_hard_block, "
            "incidental_cap, incidental_is_hard_block, day_visit_cap, day_visit_is_hard_block "
            "FROM expense_limits WHERE policy_version_id = 1"
        )
    ).all()
    if len(limits) != len(SEED_LEVELS) * 3:
        return False
    for row in limits:
        if row.impact_level_id not in range(1, len(SEED_LEVELS) + 1) or row.city_group not in SEED_GROUP_MULTIPLIER:
            return False
        actual = (
            _money(row.hotel_cap), bool(row.hotel_is_hard_block), _money(row.food_cap), bool(row.food_is_hard_block),
            _money(row.incidental_cap), bool(row.incidental_is_hard_block),
            _money(row.day_visit_cap), bool(row.day_visit_is_hard_block),
        )
        if actual != _seed_limit(row.impact_level_id, row.city_group):
            return False
    categories = conn.execute(
        sa.text("SELECT id, name FROM expense_categories WHERE policy_version_id = 1 ORDER BY id")
    ).all()
    return [(row.id, row.name) for row in categories] == list(enumerate(SEED_CATEGORIES, start=1))


def _apply_levels(conn) -> dict[str, int]:
    ids = {}
    for code, name, air, air_class, trains, modes, twin in LEVELS:
        params = {
            "code": code,
            "name": name,
            "air": air,
            "air_class": air_class,
            "conditions": json.dumps({"approval_required": air == "CONDITIONAL"}),
            "trains": json.dumps(trains),
            "modes": json.dumps(modes),
            "rate_4w": VEHICLE_RATE_4W,
            "rate_2w": VEHICLE_RATE_2W,
            "twin": int(twin),
        }
        found = conn.execute(
            sa.text("SELECT id FROM impact_levels WHERE policy_version_id = 1 AND level_code = :code"), params
        ).first()
        if found:
            # The level's name is kept: the policy names levels only by code.
            conn.execute(
                sa.text(
                    "UPDATE impact_levels SET air_eligibility = :air, air_class_allowed = :air_class, "
                    "air_eligibility_conditions = :conditions, train_classes_allowed = :trains, "
                    "local_conveyance_modes = :modes, vehicle_rate_4w = :rate_4w, vehicle_rate_2w = :rate_2w, "
                    "twin_sharing_mandatory = :twin WHERE id = :id"
                ),
                {**params, "id": found.id},
            )
            ids[code] = found.id
        else:
            conn.execute(
                sa.text(
                    "INSERT INTO impact_levels (level_code, level_name, air_eligibility, air_class_allowed, "
                    "air_eligibility_conditions, train_classes_allowed, local_conveyance_modes, vehicle_rate_4w, "
                    "vehicle_rate_2w, twin_sharing_mandatory, is_deprecated, policy_version_id) VALUES (:code, "
                    ":name, :air, :air_class, :conditions, :trains, :modes, :rate_4w, :rate_2w, :twin, 0, 1)"
                ),
                params,
            )
            ids[code] = conn.execute(
                sa.text("SELECT id FROM impact_levels WHERE policy_version_id = 1 AND level_code = :code"), params
            ).scalar_one()
    return ids


def _apply_limits(conn, level_ids: dict[str, int]) -> None:
    for code, group, hotel, hotel_hard, food, food_hard, ie, ie_hard, day, day_hard in LIMITS:
        params = {
            "level": level_ids[code], "group": group,
            "hotel": hotel, "hotel_hard": int(hotel_hard), "food": food, "food_hard": int(food_hard),
            "ie": ie, "ie_hard": int(ie_hard), "day": day, "day_hard": int(day_hard),
        }
        found = conn.execute(
            sa.text(
                "SELECT id FROM expense_limits WHERE policy_version_id = 1 AND impact_level_id = :level "
                "AND city_group = :group"
            ),
            params,
        ).first()
        if found:
            conn.execute(
                sa.text(
                    "UPDATE expense_limits SET hotel_cap = :hotel, hotel_is_hard_block = :hotel_hard, "
                    "food_cap = :food, food_is_hard_block = :food_hard, incidental_cap = :ie, "
                    "incidental_is_hard_block = :ie_hard, day_visit_cap = :day, day_visit_is_hard_block = :day_hard "
                    "WHERE id = :id"
                ),
                {**params, "id": found.id},
            )
        else:
            conn.execute(
                sa.text(
                    "INSERT INTO expense_limits (policy_version_id, impact_level_id, city_group, hotel_cap, "
                    "hotel_is_hard_block, food_cap, food_is_hard_block, incidental_cap, incidental_is_hard_block, "
                    "day_visit_cap, day_visit_is_hard_block) VALUES (1, :level, :group, :hotel, :hotel_hard, "
                    ":food, :food_hard, :ie, :ie_hard, :day, :day_hard)"
                ),
                params,
            )


def _apply_categories(conn) -> None:
    for old, new in RENAMES.items():
        conn.execute(
            sa.text("UPDATE expense_categories SET name = :new WHERE policy_version_id = 1 AND name = :old"),
            {"old": old, "new": new},
        )
    for name in DEACTIVATE:
        conn.execute(
            sa.text("UPDATE expense_categories SET is_active = 0 WHERE policy_version_id = 1 AND name = :name"),
            {"name": name},
        )
    ids = {
        row.name: row.id
        for row in conn.execute(sa.text("SELECT id, name FROM expense_categories WHERE policy_version_id = 1")).all()
    }
    for name, parent, bill, gst, blacklist, notes in CATEGORIES:
        params = {
            "name": name,
            "parent": ids[parent] if parent else None,
            "bill": int(bill),
            "gst": int(gst),
            "blacklist": json.dumps(blacklist),
            "notes": notes,
        }
        if name in ids:
            conn.execute(
                sa.text(
                    "UPDATE expense_categories SET parent_category_id = :parent, bill_mandatory = :bill, "
                    "gst_invoice_required = :gst, blacklisted_items = :blacklist, notes = :notes, is_active = 1 "
                    "WHERE id = :id"
                ),
                {**params, "id": ids[name]},
            )
        else:
            conn.execute(
                sa.text(
                    "INSERT INTO expense_categories (name, parent_category_id, bill_mandatory, gst_invoice_required, "
                    "blacklisted_items, notes, is_active, policy_version_id) VALUES (:name, :parent, :bill, :gst, "
                    ":blacklist, :notes, 1, 1)"
                ),
                params,
            )
            ids[name] = conn.execute(
                sa.text("SELECT id FROM expense_categories WHERE policy_version_id = 1 AND name = :name"), params
            ).scalar_one()


def _apply_cities(conn) -> None:
    """Replaces the seed's 14 sample cities with clause 4's lists. Left alone if anyone has edited
    the cities or tiers, or the default tier isn't Group C."""
    rows = conn.execute(sa.text("SELECT city_name, group_type, effective_from, effective_to FROM city_groups")).all()
    seeded = {(row.city_name, row.group_type) for row in rows}
    if (
        len(rows) != len(SEED_CITIES)
        or seeded != SEED_CITIES
        or any(str(row.effective_from) != SEED_EFFECTIVE_FROM or row.effective_to is not None for row in rows)
    ):
        return
    tiers = conn.execute(sa.text("SELECT code, is_default, is_deprecated FROM city_group_tiers")).all()
    if {(row.code, bool(row.is_default), bool(row.is_deprecated)) for row in tiers} != {
        ("A", False, False), ("B", False, False), ("C", True, False)
    }:
        return
    conn.execute(sa.text("DELETE FROM city_groups"))
    for group, cities in CITIES.items():
        for city in cities:
            conn.execute(
                sa.text("INSERT INTO city_groups (city_name, group_type, effective_from) VALUES (:city, :group, :start)"),
                {"city": city, "group": group, "start": EFFECTIVE_FROM},
            )


def upgrade() -> None:
    conn = op.get_bind()
    if not _still_the_seed(conn):
        print(
            "Travel policy defaults: policy version 1 isn't the seed's placeholder anymore (or there's no "
            "policy yet), so it was left as it is."
        )
        return
    conn.execute(sa.text("UPDATE policy_versions SET effective_from = :start WHERE id = 1"), {"start": EFFECTIVE_FROM})
    _apply_limits(conn, _apply_levels(conn))
    _apply_categories(conn)
    _apply_cities(conn)


def downgrade() -> None:
    # Data only: the policy values stay (they're changed in Policy Administration).
    pass
