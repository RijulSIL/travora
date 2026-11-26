"""The travel policy Travora starts from: SIL Interim Travel Policy - Domestic
(HR Policy SIL/HR/Travel Policy-Domestic/2026), in effect from 13/03/2026.

One place for the policy's numbers and names. The seed (core/seed.py) builds a fresh install's
first policy version from it, and the expense classifier (services/expense_classifier.py) files
bills under its categories. Admins change the live values in Policy Administration; this file
is only the starting point. Migration b7d2e4f9a1c3 carries a frozen copy for existing databases.

Clause references (e.g. "2.2") are to the policy document.
"""

from datetime import date

POLICY_EFFECTIVE_FROM = date(2026, 3, 13)

# ── Local conveyance (Table 1 + Note 2) ────────────────────────────────────────────────────────
# Most to least expensive. A level may use its own modes and any cheaper one: the limits are upper
# limits, not entitlements (2.7). Using a mode outside your level needs HRBP + CEO approval (Note 1).
MODE_HIRED_TAXI = "Hired Taxi / Innova"
MODE_RIDE_PREMIUM = "Ride Hailing (Sedan / Premium)"
MODE_RIDE_ECONOMY = "Ride Hailing (Go) / Shared Taxi"
MODE_COMPANY_VEHICLE = "Company Booked Vehicle"
MODE_AUTO = "Auto Rickshaw"
MODE_PUBLIC_TRANSPORT = "Metro / Public Transport"
MODE_PERSONAL_VEHICLE = "Personal Vehicle"
CONVEYANCE_MODES = (
    MODE_HIRED_TAXI,
    MODE_RIDE_PREMIUM,
    MODE_RIDE_ECONOMY,
    MODE_COMPANY_VEHICLE,
    MODE_AUTO,
    MODE_PUBLIC_TRANSPORT,
    MODE_PERSONAL_VEHICLE,
)

_MODES_L1 = list(CONVEYANCE_MODES)
_MODES_L2_L3 = [
    MODE_RIDE_PREMIUM, MODE_RIDE_ECONOMY, MODE_COMPANY_VEHICLE, MODE_AUTO, MODE_PUBLIC_TRANSPORT, MODE_PERSONAL_VEHICLE,
]
_MODES_L4 = [MODE_RIDE_ECONOMY, MODE_COMPANY_VEHICLE, MODE_AUTO, MODE_PUBLIC_TRANSPORT, MODE_PERSONAL_VEHICLE]
_MODES_L5_L6 = [MODE_RIDE_ECONOMY, MODE_AUTO, MODE_PUBLIC_TRANSPORT, MODE_PERSONAL_VEHICLE]

# Own vehicle with the reporting manager's prior approval (Note 2), per km.
VEHICLE_RATE_4W = "8.50"
VEHICLE_RATE_2W = "4.00"

# Train classes (Table 1): the level's class and the cheaper ones below it.
_TRAIN_L1_L3 = ["1A", "EC", "2A", "3A", "CC", "SL"]  # 1AC / Executive Chair Car
_TRAIN_L4_L5 = ["2A", "3A", "CC", "SL"]  # 2AC / AC Chair Car
_TRAIN_L6 = ["3A", "CC", "SL"]  # 3AC / Chair Car

# ── Impact levels (Table 1) ────────────────────────────────────────────────────────────────────
# (code, name, air eligibility, air class, train classes, local conveyance modes, twin sharing)
# Air: Level 1 Premium Economy/Economy, Levels 2-4 Economy. Levels 5-6 only for journeys over
# 12 hours or exigency, with function head, Group Head HR and CEO approval -> CONDITIONAL.
# Twin sharing: 5B to 6D, when travelling with equivalent levels (Table 2 footnote).
# The policy names levels only by code; the names are Travora's existing labels.
IMPACT_LEVELS = [
    ("L1", "CXO / Director", "YES", "PREMIUM_ECONOMY", _TRAIN_L1_L3, _MODES_L1, False),
    ("L2", "VP / Senior Director", "YES", "ECONOMY", _TRAIN_L1_L3, _MODES_L2_L3, False),
    ("L3A", "Senior Manager", "YES", "ECONOMY", _TRAIN_L1_L3, _MODES_L2_L3, False),
    ("L3B", "Manager", "YES", "ECONOMY", _TRAIN_L1_L3, _MODES_L2_L3, False),
    ("L4A", "Deputy Manager", "YES", "ECONOMY", _TRAIN_L4_L5, _MODES_L4, False),
    ("L4B", "Assistant Manager", "YES", "ECONOMY", _TRAIN_L4_L5, _MODES_L4, False),
    ("L4C", "Senior Executive", "YES", "ECONOMY", _TRAIN_L4_L5, _MODES_L4, False),
    ("L5A", "Executive", "CONDITIONAL", "ECONOMY", _TRAIN_L4_L5, _MODES_L5_L6, False),
    ("L5B", "Senior Associate", "CONDITIONAL", "ECONOMY", _TRAIN_L4_L5, _MODES_L5_L6, True),
    ("L5C", "Level 5C", "CONDITIONAL", "ECONOMY", _TRAIN_L4_L5, _MODES_L5_L6, True),
    ("L6A", "Associate I", "CONDITIONAL", "ECONOMY", _TRAIN_L6, _MODES_L5_L6, True),
    ("L6B", "Associate II", "CONDITIONAL", "ECONOMY", _TRAIN_L6, _MODES_L5_L6, True),
    ("L6C", "Associate III", "CONDITIONAL", "ECONOMY", _TRAIN_L6, _MODES_L5_L6, True),
    ("L6D", "Trainee", "CONDITIONAL", "ECONOMY", _TRAIN_L6, _MODES_L5_L6, True),
]

# ── Limits (Table 2) ───────────────────────────────────────────────────────────────────────────
# Per level band: room rent per night and food per day for Group A / B / C cities, incidental
# expenses per night (all locations), and the day-visit limit per day (no night stay).
# None = "Actual" (no limit). Room rent and food are before taxes (2.1); room rent includes laundry.
LIMIT_BANDS = {
    "1": {"hotel": (None, None, None), "food": (None, None, None), "incidental": 800, "day_visit": None},
    "2A-3A": {"hotel": (9000, 8000, 6000), "food": (None, None, None), "incidental": 500, "day_visit": 400},
    "3B-4A": {"hotel": (7000, 6000, 5000), "food": (None, None, None), "incidental": 400, "day_visit": 300},
    "4B-5A": {"hotel": (5000, 4000, 3000), "food": (1500, 1200, 1200), "incidental": 200, "day_visit": 250},
    "5B-6A": {"hotel": (4000, 3500, 3000), "food": (1000, 800, 700), "incidental": 200, "day_visit": 200},
    "6B-6C": {"hotel": (2500, 2000, 2000), "food": (600, 600, 500), "incidental": 100, "day_visit": 150},
    "6D": {"hotel": (2000, 1500, 1200), "food": (500, 500, 400), "incidental": 75, "day_visit": 100},
}
LEVEL_BAND = {
    "L1": "1",
    "L2": "2A-3A", "L3A": "2A-3A",
    "L3B": "3B-4A", "L4A": "3B-4A",
    "L4B": "4B-5A", "L4C": "4B-5A", "L5A": "4B-5A",
    "L5B": "5B-6A", "L5C": "5B-6A", "L6A": "5B-6A",
    "L6B": "6B-6C", "L6C": "6B-6C",
    "L6D": "6D",
}
CITY_GROUP_CODES = ("A", "B", "C")
# Room rent: "no deviation is allowed" without CEO approval (2.4.2) -> hard block. The rest flag.
HARD_BLOCK = {"hotel": True, "food": False, "incidental": False, "day_visit": False}


def expense_limit_rows() -> list[dict]:
    """One row per (level, city group) with the Table 2 limits."""
    rows = []
    for code, *_ in IMPACT_LEVELS:
        band = LIMIT_BANDS[LEVEL_BAND[code]]
        for index, group in enumerate(CITY_GROUP_CODES):
            rows.append(
                {
                    "level_code": code,
                    "city_group": group,
                    "hotel_cap": band["hotel"][index],
                    "hotel_is_hard_block": HARD_BLOCK["hotel"],
                    "food_cap": band["food"][index],
                    "food_is_hard_block": HARD_BLOCK["food"],
                    "incidental_cap": band["incidental"],
                    "incidental_is_hard_block": HARD_BLOCK["incidental"],
                    "day_visit_cap": band["day_visit"],
                    "day_visit_is_hard_block": HARD_BLOCK["day_visit"],
                }
            )
    return rows


# ── Cities (clause 4) ──────────────────────────────────────────────────────────────────────────
# Cities match by exact name, so the common spellings and the named suburbs are listed too.
# Group C is every other place (the default tier).
CITY_GROUP_TIERS = [("A", "Group A", False), ("B", "Group B", False), ("C", "Group C", True)]
GROUP_A_CITIES = [
    "Mumbai", "Bombay", "Thane", "Navi Mumbai",
    "Delhi NCR", "Delhi", "New Delhi", "Noida", "Greater Noida", "Faridabad", "Gurgaon", "Gurugram", "Ghaziabad",
    "Kolkata", "Calcutta", "Chennai", "Madras", "Pune",
    "Bangalore", "Bengaluru", "Hyderabad", "Secunderabad", "Ahmedabad",
]
GROUP_B_CITIES = [
    # Other state and union territory capitals.
    "Amaravati", "Itanagar", "Dispur", "Guwahati", "Patna", "Raipur", "Nava Raipur", "Panaji", "Panjim",
    "Gandhinagar", "Chandigarh", "Shimla", "Ranchi", "Thiruvananthapuram", "Trivandrum", "Bhopal", "Imphal",
    "Shillong", "Aizawl", "Kohima", "Bhubaneswar", "Jaipur", "Gangtok", "Agartala", "Lucknow", "Dehradun",
    "Gairsain", "Port Blair", "Sri Vijaya Puram", "Daman", "Srinagar", "Jammu", "Leh", "Kavaratti",
    "Puducherry", "Pondicherry",
    # Named in the policy (with other spellings).
    "Goa", "Margao", "Madgaon", "Vasco da Gama", "Mapusa", "Agra", "Cochin", "Kochi", "Ernakulam",
    "Calicut", "Kozhikode", "Coimbatore", "Indore", "Kanpur", "Surat", "Udaipur", "Varanasi",
    "Visakhapatnam", "Vishakhapatnam", "Vizag", "Vijayawada", "Vijaywada", "Ludhiana", "Cuttack",
    "Vadodara", "Baroda", "Mangalore", "Mangaluru", "Mysore", "Mysuru", "Hubli", "Hubballi", "Belgaum",
    "Belagavi", "Nagpur", "Aurangabad", "Chhatrapati Sambhajinagar", "Allahabad", "Prayagraj", "Gorakhpur",
    "Amritsar", "Jalandhar", "Bareilly", "Paradeep", "Paradip", "Bathinda", "Lakhimpur", "Lakhimpur Kheri",
    "North Lakhimpur", "Meerut",
]


def city_group_rows() -> list[tuple[str, str]]:
    return [(city, "A") for city in GROUP_A_CITIES] + [(city, "B") for city in GROUP_B_CITIES]


# ── Expense categories (how bills are classified) ──────────────────────────────────────────────
CATEGORY_AIR = "Air Travel"
CATEGORY_TRAIN = "Train Travel"
CATEGORY_BUS = "Bus Travel"
CATEGORY_CONVEYANCE = "Local Conveyance"
CATEGORY_ROOM_RENT = "Hotel Room Rent (incl. Laundry)"
CATEGORY_FOOD = "Food & Meals"
CATEGORY_INCIDENTAL = "Incidental Expenses"
CATEGORY_DAY_VISIT = "Day Visit Expenses"
# Clause 3.1. Matched as text against the line, vendor and file name, so kept to words that don't
# turn up in ordinary restaurant names; the classifier also asks Gemini to flag such lines.
NO_ALCOHOL_OR_TOBACCO = ["Alcohol", "Liquor", "Cigarette", "Tobacco"]

# (name, parent name, bill needed, GST invoice needed, items never reimbursed, notes)
EXPENSE_CATEGORIES = [
    (CATEGORY_AIR, None, True, True, ["Business Class", "First Class"],
     "Economy; Premium Economy for Level 1. Levels 5-6 only with approval (journey over 12 hours or "
     "exigency). Book at least a week ahead. Boarding pass needed."),
    (CATEGORY_TRAIN, None, True, False, [],
     "1AC/EC for Levels 1-3, 2AC/CC for Levels 4-5, 3AC/CC for Level 6. Ticket needed."),
    (CATEGORY_BUS, None, True, False, [], "AC bus. Ticket needed."),
    (CATEGORY_CONVEYANCE, None, False, False, [], "Mode by impact level; other modes need HRBP and CEO approval."),
    (MODE_HIRED_TAXI, CATEGORY_CONVEYANCE, True, False, [], "Level 1."),
    (MODE_RIDE_PREMIUM, CATEGORY_CONVEYANCE, True, False, [], "Uber Sedan/Premium or equivalent. Levels 1-3."),
    (MODE_RIDE_ECONOMY, CATEGORY_CONVEYANCE, True, False, [], "Uber Go or equivalent, or a shared taxi. All levels."),
    (MODE_COMPANY_VEHICLE, CATEGORY_CONVEYANCE, False, False, [], "Levels 1-4."),
    (MODE_AUTO, CATEGORY_CONVEYANCE, False, False, [],
     "Uber Auto or equivalent. No bill needed; fare must be less than a non-AC taxi."),
    (MODE_PUBLIC_TRANSPORT, CATEGORY_CONVEYANCE, False, False, [],
     "No bill needed for metro; fare must be less than a non-AC taxi."),
    (MODE_PERSONAL_VEHICLE, CATEGORY_CONVEYANCE, False, False, [],
     "₹8.50/km four-wheeler, ₹4/km two-wheeler, with the reporting manager's prior approval."),
    (CATEGORY_ROOM_RENT, None, True, True, NO_ALCOHOL_OR_TOBACCO,
     "Per night, before taxes, including laundry. Stay in a company guest house where available "
     "(then only food and incidentals are paid)."),
    (CATEGORY_FOOD, None, True, False, NO_ALCOHOL_OR_TOBACCO,
     "Per day, before taxes. Outstation travel with an overnight stay only. Food without a bill and "
     "kaccha bills go under Incidental Expenses."),
    (CATEGORY_INCIDENTAL, None, False, False, NO_ALCOHOL_OR_TOBACCO,
     "Per night, all locations. Includes food without a bill and kaccha bills."),
    (CATEGORY_DAY_VISIT, None, False, False, NO_ALCOHOL_OR_TOBACCO,
     "Per day, for day visits without a night stay. External meetings need the CEO's prior approval."),
]
