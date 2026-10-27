"""Trains between two cities on a date, from the Indian Railways timetable (the "IRCTC1" API on
RapidAPI, by IRCTCAPI). Used by travel_request_service.search_travel_options instead of a Gemini
web search whenever RAPIDAPI_KEY is set, because a timetable is complete and exact where a web
search isn't.

One request covers a whole city: asked for one station, the API also returns trains from and to
the city's other stations (Borivali → New Delhi includes CSMT, Dadar, Thane… → Nizamuddin,
Sarai Rohilla…). Our plan has a small monthly request allowance, so results are saved and every
time window is filtered from the same saved list.
"""

from __future__ import annotations

import logging
import re
from datetime import date
from typing import Any

import httpx

logger = logging.getLogger(__name__)

TRAINS_BETWEEN_PATH = "/api/v3/trainBetweenStations"
DATE_FORMAT = "%Y-%m-%d"  # dateOfJourney
REQUEST_TIMEOUT_SECONDS = 25

# City names people type (lower case, see _city_key) → the main station's code.
STATION_CODES: dict[str, str] = {
    **dict.fromkeys(["delhi", "new delhi", "delhi ncr", "ncr", "gurgaon", "gurugram", "noida", "ghaziabad",
                     "faridabad"], "NDLS"),
    **dict.fromkeys(["mumbai", "bombay", "navi mumbai", "thane"], "CSMT"),
    **dict.fromkeys(["bengaluru", "bangalore"], "SBC"),
    **dict.fromkeys(["chennai", "madras"], "MAS"),
    **dict.fromkeys(["kolkata", "calcutta", "howrah"], "HWH"),
    **dict.fromkeys(["hyderabad", "secunderabad"], "SC"),
    "pune": "PUNE",
    "ahmedabad": "ADI",
    "jaipur": "JP",
    "lucknow": "LKO",
    "chandigarh": "CDG",
    **dict.fromkeys(["kochi", "cochin", "ernakulam"], "ERS"),
    "coimbatore": "CBE",
    "indore": "INDB",
    "bhopal": "BPL",
    "patna": "PNBE",
    **dict.fromkeys(["varanasi", "banaras"], "BSB"),
    "agra": "AGC",
    "kanpur": "CNB",
    "nagpur": "NGP",
    "surat": "ST",
    **dict.fromkeys(["vadodara", "baroda"], "BRC"),
    "amritsar": "ASR",
    "ludhiana": "LDH",
    "dehradun": "DDN",
    "haridwar": "HW",
    "bhubaneswar": "BBS",
    "guwahati": "GHY",
    **dict.fromkeys(["visakhapatnam", "vizag"], "VSKP"),
    "vijayawada": "BZA",
    **dict.fromkeys(["thiruvananthapuram", "trivandrum"], "TVC"),
    **dict.fromkeys(["mysuru", "mysore"], "MYS"),
    **dict.fromkeys(["mangaluru", "mangalore"], "MAQ"),
    "madurai": "MDU",
    **dict.fromkeys(["goa", "madgaon", "margao"], "MAO"),
    "nashik": "NK",
    "raipur": "R",
    "ranchi": "RNC",
    "jodhpur": "JU",
    "udaipur": "UDZ",
    "ajmer": "AII",
    "gwalior": "GWL",
    "jammu": "JAT",
    **dict.fromkeys(["prayagraj", "allahabad"], "PRYJ"),
    "gorakhpur": "GKP",
    "jabalpur": "JBP",
    "rajkot": "RJT",
    **dict.fromkeys(["kozhikode", "calicut"], "CLT"),
    **dict.fromkeys(["tiruchirappalli", "trichy"], "TPJ"),
}

_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


class RailSearchError(Exception):
    """A failed timetable search; the message is safe to show the traveler. `pause` means asking
    again soon won't help (the month's requests are used up, or the key isn't accepted)."""

    def __init__(self, message: str, *, pause: bool = False):
        super().__init__(message)
        self.pause = pause


def _city_key(city: str) -> str:
    text = re.sub(r"\s+", " ", (city or "").strip().lower())
    return re.sub(r"\s+(city|jn|junction)$", "", text)


def station_code(city: str) -> str | None:
    """The station code for a typed city; a typed station code ("NDLS", "Pune (PUNE)") is used as is."""
    typed = re.search(r"\(([A-Za-z]{1,5})\)\s*$", city or "")
    if typed:
        return typed.group(1).upper()
    key = _city_key(city)
    if key in STATION_CODES:
        return STATION_CODES[key]
    # "Mumbai Central", "Pune Station": the longest known city it starts with.
    for known in sorted(STATION_CODES, key=len, reverse=True):
        if key.startswith(f"{known} "):
            return STATION_CODES[known]
    if re.fullmatch(r"[A-Z]{2,5}", (city or "").strip()):
        return city.strip()
    return None


async def fetch_trains_between(from_code: str, to_code: str, day: date, *, api_key: str, host: str) -> dict:
    """The API's raw reply. Raises RailSearchError with a message the traveler can read."""
    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
            response = await client.get(
                f"https://{host}{TRAINS_BETWEEN_PATH}",
                params={
                    "fromStationCode": from_code,
                    "toStationCode": to_code,
                    "dateOfJourney": day.strftime(DATE_FORMAT),
                },
                headers={"x-rapidapi-key": api_key, "x-rapidapi-host": host},
            )
    except httpx.HTTPError as e:
        logger.warning("Train timetable request failed: %s", e)
        raise RailSearchError(
            "Couldn't reach the train timetable right now — describe the train you want instead"
        ) from e
    if response.status_code == 429:
        logger.warning("Train timetable: this month's requests are used up")
        raise RailSearchError(
            "Train search has reached this month's limit — describe the train you want instead", pause=True
        )
    if response.status_code in (401, 403):
        logger.error("Train timetable refused the RapidAPI key (%s): %s", response.status_code, response.text[:200])
        raise RailSearchError(
            "Train search isn't set up correctly yet — describe the train you want instead", pause=True
        )
    if response.status_code != 200:
        logger.warning("Train timetable answered %s: %s", response.status_code, response.text[:200])
        raise RailSearchError("Couldn't search trains right now — describe the train you want instead")
    try:
        payload = response.json()
    except ValueError as e:
        raise RailSearchError("Couldn't search trains right now — describe the train you want instead") from e
    if not isinstance(payload, dict) or payload.get("status") is False:
        logger.warning("Train timetable said no: %s", str(payload)[:200])
        raise RailSearchError("Couldn't search trains right now — describe the train you want instead")
    return payload


def _station_name(name: str) -> str:
    """'DELHI HAZRAT NIZAMUDDIN' → 'Delhi Hazrat Nizamuddin'; codes without vowels stay ('MUMBAI CSMT')."""
    words = (name or "").split()
    return " ".join(w.capitalize() if re.search(r"[AEIOU]", w.upper()) and len(w) > 1 else w for w in words)


def _duration(text: str) -> str:
    """'15:8' → '15h 08m'."""
    match = re.fullmatch(r"\s*(\d{1,3}):(\d{1,2})\s*", text or "")
    return f"{int(match.group(1))}h {int(match.group(2)):02d}m" if match else (text or "")[:16]


def _int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def parse_trains(payload: dict, day: date) -> list[dict[str, Any]]:
    """Every train in the reply as a travel option (all classes kept in `classes`; the caller picks
    the in-policy ones). A train shown as leaving its first station that day but not running on
    that weekday is left out."""
    weekday = _WEEKDAYS[day.weekday()]
    options = []
    for train in payload.get("data") or []:
        if not isinstance(train, dict) or not train.get("train_number") or not train.get("from_std"):
            continue
        run_days = train.get("run_days") or []
        if _int(train.get("from_day")) == 0 and run_days and weekday not in run_days:
            continue
        days_later = _int(train.get("to_day")) - _int(train.get("from_day"))
        arrive = str(train.get("to_sta") or "")[:5]
        options.append(
            {
                "name": str(train.get("train_name") or "")[:80],
                "number": str(train["train_number"])[:24],
                "operator": "Indian Railways",
                "depart_time": str(train["from_std"])[:5],
                "arrive_time": f"{arrive} +{days_later}" if arrive and days_later > 0 else arrive,
                "from_station": _station_name(str(train.get("from_station_name") or train.get("from") or ""))[:80],
                "to_station": _station_name(str(train.get("to_station_name") or train.get("to") or ""))[:80],
                "duration": _duration(str(train.get("duration") or "")),
                "travel_class": "",
                "fare_inr": None,
                "classes": [str(c).upper() for c in (train.get("class_type") or []) if c],
                "source": "timetable",
            }
        )
    return options
