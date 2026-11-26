"""Files each bill line under a category of the travel policy (app.core.policy_defaults).

Gemini reads the bill and says what each line is for (category_hint, plus conveyance_mode for
rides) and what the whole bill is for (expense_category). Those answers win: the line's first,
then the bill's. Words on the bill are only a fallback for when Gemini gave nothing (or there was
no Gemini at all), and even then the clearest words win over incidental ones, so a restaurant
called "Hotel X" or a cab ride "to the hotel" isn't filed as room rent just because the word
"hotel" appears somewhere. (The old rule joined every signal into one string and let whichever
keyword came first in a fixed list win, which overrode Gemini's correct answer on common bills.)

Then the policy's own rules (clause numbers from the policy document):
- room rent includes laundry (Table 2), so laundry on a hotel bill is room rent;
- every line of a kaccha (handwritten / informal) bill is an Incidental Expense, whatever it was
  for (2.2: "All kaccha bills shall be included as part of incidental expenses");
- fuel for an own vehicle is Personal Vehicle conveyance (Note 2);
- a ride is filed under its mode (Table 1), which the level eligibility check reads.
Day visits (no night stay) are decided per claim, not per bill: see reimbursement_service.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.core import policy_defaults as P

TRAVEL_CATEGORIES = {
    "air": P.CATEGORY_AIR,
    "train": P.CATEGORY_TRAIN,
    "bus": P.CATEGORY_BUS,
    "conveyance": P.CATEGORY_CONVEYANCE,
    "room_rent": P.CATEGORY_ROOM_RENT,
    "food": P.CATEGORY_FOOD,
    "incidental": P.CATEGORY_INCIDENTAL,
}
# Outside the travel policy: general reimbursements, which have no limits.
OTHER_CATEGORIES = {
    "software": "Software/Subscription",
    "office_supplies": "Office Supplies",
    "telecom": "Telecom & Internet",
    "professional": "Professional Services",
    "courier": "Courier & Postage",
}
CATEGORY_NAMES = {**TRAVEL_CATEGORIES, **OTHER_CATEGORIES}

MODE_NAMES = {
    "hired_taxi": P.MODE_HIRED_TAXI,
    "ride_premium": P.MODE_RIDE_PREMIUM,
    "ride_economy": P.MODE_RIDE_ECONOMY,
    "company_vehicle": P.MODE_COMPANY_VEHICLE,
    "auto": P.MODE_AUTO,
    "public_transport": P.MODE_PUBLIC_TRANSPORT,
    "personal_vehicle": P.MODE_PERSONAL_VEHICLE,
}

# Names the same categories had before this policy, so a database whose categories were never
# renamed still links bills to them.
LEGACY_NAMES = {
    P.CATEGORY_ROOM_RENT: ("Hotel/Accommodation",),
    P.MODE_HIRED_TAXI: ("Cab/Taxi",),
    P.MODE_RIDE_PREMIUM: ("Uber",),
    P.MODE_AUTO: ("Auto",),
    P.MODE_PUBLIC_TRANSPORT: ("Metro",),
}

# Gemini's per-line category_hint (and older spellings) -> key.
_LINE_HINTS = {
    "air": "air", "flight": "air", "train": "train", "rail": "train", "bus": "bus",
    "conveyance": "conveyance", "taxi": "conveyance", "cab": "conveyance", "fuel": "fuel",
    "room_rent": "room_rent", "room rent": "room_rent", "hotel": "room_rent", "room": "room_rent",
    "accommodation": "room_rent", "laundry": "room_rent",
    "food": "food", "meal": "food", "meals": "food",
    "incidental": "incidental", "incidentals": "incidental",
    "software": "software", "office_supplies": "office_supplies", "supplies": "office_supplies",
    "telecom": "telecom", "professional": "professional", "courier": "courier",
}
# Gemini's bill-level expense_category (and the older list's names) -> key.
_BILL_CATEGORIES = {
    "air travel": "air", "train travel": "train", "bus travel": "bus", "local conveyance": "conveyance",
    "hotel room rent": "room_rent", "hotel room rent (incl. laundry)": "room_rent", "hotel/accommodation": "room_rent",
    "food & meals": "food", "incidental expenses": "incidental", "incidentals": "incidental",
    "fuel": "fuel", "software/subscription": "software", "office supplies": "office_supplies",
    "telecom & internet": "telecom", "professional services": "professional", "courier & postage": "courier",
}
_MODE_HINTS = {**{key: key for key in MODE_NAMES}, "shared_taxi": "ride_economy", "metro": "public_transport"}

# Fallback words. Categories are tried in this order, each against the description, the vendor
# and the file name; the first category with a match wins. Fares come first (a ticket that
# includes a meal is still a ticket), then the unmistakable food words, then room words, then
# general food words, and the bare "hotel"/"inn" words last.
_WORDS: list[tuple[str, tuple[str, ...]]] = [
    ("air", ("flight", "airline", "airlines", "air", "indigo", "vistara", "air india", "airindia", "spicejet",
             "akasa", "aeroplane", "boarding pass")),
    ("train", ("train", "irctc", "railway", "railways", "rail", "rajdhani", "shatabdi", "vande bharat")),
    ("bus", ("bus", "redbus", "volvo", "coach", "intrcity")),
    ("fuel", ("fuel", "petrol", "diesel", "cng", "filling station", "petrol pump")),
    ("conveyance", ("uber", "ola", "rapido", "meru", "blusmart", "taxi", "cab", "cabs", "rickshaw", "autorickshaw",
                    "auto rickshaw", "uber auto", "metro", "ride", "rides", "pickup", "drop", "conveyance",
                    "innova", "car rental", "chauffeur")),
    ("food", ("room service", "restaurant", "minibar", "mini bar", "dining", "cafe", "café", "dhaba", "canteen",
              "swiggy", "zomato", "thali", "biryani")),
    ("room_rent", ("room", "rooms", "accommodation", "lodging", "laundry", "tariff", "stay", "guest house",
                   "check in", "check out")),
    ("food", ("meal", "meals", "food", "breakfast", "lunch", "dinner", "snacks", "beverages", "tea", "coffee")),
    ("software", ("software", "subscription", "saas", "license", "licence", "cloud")),
    ("telecom", ("telecom", "internet", "broadband", "mobile", "postpaid", "prepaid", "recharge", "wifi",
                 "airtel", "jio", "vodafone")),
    ("professional", ("consulting", "consultant", "professional", "legal", "audit", "advisory", "freelance")),
    ("courier", ("courier", "postage", "speedpost", "speed post", "dtdc", "fedex", "bluedart")),
    ("office_supplies", ("stationery", "stationary", "supplies", "printer", "printing", "toner")),
    ("incidental", ("tips", "tip", "porter", "porterage", "toll", "parking")),
    ("room_rent", ("hotel", "inn", "resort", "residency", "suites", "lodge")),
]
_MODE_WORDS: list[tuple[str, tuple[str, ...]]] = [
    ("personal_vehicle", ("fuel", "petrol", "diesel", "cng", "own vehicle", "mileage")),
    ("public_transport", ("metro", "dmrc", "bmrcl", "local train", "suburban", "city bus", "bmtc", "best bus")),
    ("auto", ("auto rickshaw", "autorickshaw", "rickshaw", "uber auto", "ola auto", "rapido auto", "bike taxi",
              "uber moto", "rapido bike")),
    ("hired_taxi", ("innova", "hired taxi", "car rental", "rental car", "chauffeur", "outstation cab",
                    "local package", "full day")),
    ("ride_premium", ("premier", "uber premier", "sedan", "prime", "uber xl", "xl", "suv", "uber black")),
    ("ride_economy", ("uber go", "ubergo", "ola mini", "mini", "shared", "pool", "share")),
    ("company_vehicle", ("company vehicle", "company car", "pool car")),
]


@dataclass(frozen=True)
class LineCategory:
    key: str  # 'air', 'room_rent', 'conveyance', 'software', ...
    name: str  # the category to file it under: a ride's mode when known, else the policy category
    mode_key: str = ""  # 'ride_economy', 'auto', ... for a ride whose mode is known

    @property
    def parent(self) -> str | None:
        return P.CATEGORY_CONVEYANCE if self.mode_key else None

    @property
    def bill_label(self) -> str:
        """The bill-level label (the invoice's "Expense category" field)."""
        return CATEGORY_NAMES.get(self.key, self.name)

    @property
    def lookup_names(self) -> tuple[str, ...]:
        """Category names to link to, most specific first: the ride's mode, then Local Conveyance."""
        names = [self.name, *LEGACY_NAMES.get(self.name, ())]
        if self.parent:
            names.append(self.parent)
        return tuple(names)


def _norm(text: str | None) -> str:
    return " ".join(re.sub(r"[_\-]+", " ", str(text or "").lower()).split())


def _has_word(text: str, word: str) -> bool:
    return re.search(rf"(?<!\w){re.escape(word)}(?!\w)", text) is not None


def _from_words(table: list[tuple[str, tuple[str, ...]]], *signals: str) -> str | None:
    texts = [_norm(s) for s in signals if s]
    for key, words in table:
        if any(_has_word(text, word) for text in texts for word in words):
            return key
    return None


def is_truthy(value: object) -> bool:
    """A Gemini "true"/"false" string field as a bool."""
    return str(value or "").strip().lower() in ("true", "yes", "1")


def classify_line(
    *,
    line_hint: str = "",
    mode_hint: str = "",
    bill_category: str = "",
    description: str = "",
    vendor: str = "",
    filename: str = "",
    kaccha: bool = False,
) -> LineCategory:
    """The category a bill line goes under. See the module docstring for the order of signals."""
    if kaccha:
        # "All kaccha bills shall be included as part of incidental expenses" (2.2), whatever they're for.
        return LineCategory(key="incidental", name=CATEGORY_NAMES["incidental"])
    key = _LINE_HINTS.get(_norm(line_hint).replace(" ", "_")) or _LINE_HINTS.get(_norm(line_hint))
    if key is None:
        key = _BILL_CATEGORIES.get(_norm(bill_category).replace(" / ", "/"))
    if key is None:
        key = _from_words(_WORDS, description, vendor, filename) or "incidental"

    mode_key = _MODE_HINTS.get(_norm(mode_hint).replace(" ", "_"), "")
    if key == "fuel":
        key, mode_key = "conveyance", "personal_vehicle"
    if key != "conveyance":
        return LineCategory(key=key, name=CATEGORY_NAMES[key])
    if not mode_key:
        mode_key = _from_words(_MODE_WORDS, description, vendor) or ""
    if mode_key:
        return LineCategory(key=key, name=MODE_NAMES[mode_key], mode_key=mode_key)
    return LineCategory(key=key, name=P.CATEGORY_CONVEYANCE)


def conveyance_mode_of(category_name: str | None) -> str | None:
    """The Table 1 mode a stored category stands for (None for anything that isn't a known mode)."""
    if not category_name:
        return None
    if category_name in P.CONVEYANCE_MODES:
        return category_name
    for mode, legacy in LEGACY_NAMES.items():
        if mode in P.CONVEYANCE_MODES and category_name in legacy:
            return mode
    return None
