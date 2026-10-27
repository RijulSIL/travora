"""Finds real flight, train or bus options for one leg of a travel request, using Gemini with
Google Search. The traveler picks one as their recommendation to the Travel Desk. Results are
suggestions: times and fares can be out of date, and the desk confirms before booking.

Two steps, because a single search sometimes invents services or gets times wrong: find_options_sync
lists candidates, then check_option_sync looks each one up again by its number in a timetable;
anything that can't be confirmed is dropped and the timetable's times replace the first answer's.

Called through travel_request_service.search_travel_options, which keeps only in-policy classes
and saves results so the same search isn't repeated (and paid for) within a few hours."""

from __future__ import annotations

import json
import logging
import re
from datetime import date
from typing import Any

from google import genai
from google.genai import types

logger = logging.getLogger(__name__)

_JSON_ARRAY = re.compile(r"\[[\s\S]*\]")
_JSON_OBJECT = re.compile(r"\{[\s\S]*\}")

MODE_WORDS = {"FLIGHT": "flights", "TRAIN": "trains", "BUS": "buses"}


def _prompt(
    mode: str, from_city: str, to_city: str, day: date, classes: list[str], window: tuple[str, str, str]
) -> str:
    when = day.strftime("%A %d %B %Y")
    label, first, last = window
    class_rule = (
        f"Only include options bookable in these classes: {', '.join(classes)}. Use exactly one of those as the class."
        if classes
        else "Use the usual class name for the class."
    )
    number_rule = {
        "TRAIN": "Every train must have its train number; leave out any train whose number you didn't find.",
        "FLIGHT": "Every flight must have its flight number; leave out any flight whose number you didn't find.",
        "BUS": "Every bus must have its operator's name; leave out any bus whose operator you didn't find.",
    }[mode]
    return f"""\
Search the web for real, regularly scheduled {MODE_WORDS[mode]} from {from_city} to {to_city} in India
that run on {when} and leave between {first} and {last} ({label}). Return up to 5 good options, earliest first.
Only include options whose departure time is between {first} and {last}; the arrival time can be any time.
{class_rule}
Only include services that actually operate on that day. Do not invent services, numbers or times:
every detail must come from what you found. Leave a detail empty (or null) rather than guess it.
{number_rule}
List each service once.

Reply with ONLY a JSON array, no other text: start your reply with [ and end it with ]. Each item:
{{
  "name": "the train/flight/bus name",
  "number": "the train or flight number, or empty for buses",
  "operator": "airline, Indian Railways, or bus operator",
  "depart_time": "HH:MM 24-hour",
  "arrive_time": "HH:MM 24-hour",
  "from_station": "departure station/airport/stop",
  "to_station": "arrival station/airport/stop",
  "duration": "like 3h 05m",
  "travel_class": "the class",
  "fare_inr": approximate one-way fare in rupees for that class as a number, or null
}}
If you can't find any, reply with [].
"""


def _ask_json(prompt: str, *, kind: type, temperature: float, max_tokens: int, api_key: str, models: list[str]) -> Any:
    """Asks each model in turn (with Google Search) and returns the JSON list/object in its reply.
    Raises if none of them answers usefully."""
    # A search the traveler waits on: give up after 45s rather than hold the form.
    client = genai.Client(api_key=api_key, http_options=types.HttpOptions(timeout=45_000))
    pattern = _JSON_ARRAY if kind is list else _JSON_OBJECT
    last_err: Exception | None = None
    names = [m.strip() for m in models if m and m.strip()]
    # With search on, the first model now and then answers in prose instead of JSON: ask it twice.
    attempts = names[:1] * 2 + names[1:]
    for model in attempts:
        try:
            response = client.models.generate_content(
                model=model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    tools=[types.Tool(google_search=types.GoogleSearch())],
                    temperature=temperature,
                    max_output_tokens=max_tokens,
                    # Little or no extended thinking: about 6s instead of 20s+ for the same answer.
                    # "Pro" models refuse a budget of 0; 128 is the least they take.
                    thinking_config=types.ThinkingConfig(thinking_budget=128 if "pro" in model else 0),
                ),
            )
            text = response.text or ""
            match = pattern.search(text)
            if not match:
                raise ValueError(f"no JSON in the reply: {text[:120]!r}")
            raw = json.loads(match.group(0))
            if not isinstance(raw, kind):
                raise ValueError(f"reply wasn't a {kind.__name__}")
            return raw
        except (json.JSONDecodeError, ValueError) as e:
            last_err = e
            logger.warning("Option search gave an unusable reply for model %s: %s", model, e)
        except Exception as e:  # noqa: BLE001 — any API failure: try the next model
            last_err = e
            logger.warning("Option search failed for model %s: %s", model, e)
    raise RuntimeError(f"Couldn't search for options: {last_err}")


def find_options_sync(
    *,
    mode: str,
    from_city: str,
    to_city: str,
    day: date,
    classes: list[str],
    window: tuple[str, str, str],
    api_key: str,
    models: list[str],
) -> list[dict[str, Any]]:
    """Candidate options leaving in `window` (label, first HH:MM, last HH:MM). Each one still has to
    pass check_option_sync before a traveler sees it."""
    raw = _ask_json(
        _prompt(mode, from_city, to_city, day, classes, window),
        kind=list, temperature=0.2, max_tokens=4096, api_key=api_key, models=models,
    )
    return [_clean(item) for item in raw if isinstance(item, dict)][:5]


def _check_prompt(mode: str, option: dict[str, Any], from_city: str, to_city: str, day: date) -> str:
    when = day.strftime("%A %d %B %Y")
    if mode == "BUS":
        # Ask for the operator's own list rather than "is there one at <time>?", which it tends to agree with.
        return f"""\
Look up the bus timetable of {option['operator'] or option['name']} from {from_city} to {to_city} on a bus booking
or timetable site, for {when}. List the departure times of that operator's buses on this route.
Only use what the site says. Do not guess.

Reply with ONLY JSON, no other text:
{{"runs": true or false, "departures": [{{"depart_time": "HH:MM 24-hour", "arrive_time": "HH:MM 24-hour",
 "from_station": "...", "to_station": "...", "duration": "like 3h 05m"}}]}}
If you can't find its timetable, reply {{"runs": false}}.
"""
    if mode == "TRAIN":
        what = f"train number {option['number']} ({option['name']})"
        where = "a railway timetable site"
    else:
        what = f"flight {option['number']} ({option['operator'] or option['name']})"
        where = "a flight schedule or flight-tracking site"
    return f"""\
Look up the current timetable of {what} on {where}.
Answer for {when}:
- Does it run from {from_city} to {to_city} (any station, airport or stop in those cities) on that day?
- If yes: the time it LEAVES {from_city} (its departure from that station, not its arrival there), the time it
  arrives at {to_city}, the two station names, and the journey time between them.
Only use what the timetable says. Do not guess.

Reply with ONLY JSON, no other text:
{{"runs": true or false, "depart_time": "HH:MM 24-hour", "arrive_time": "HH:MM 24-hour",
 "from_station": "...", "to_station": "...", "duration": "like 3h 05m"}}
If you can't find its timetable, reply {{"runs": false}}.
"""


def _clock(value: str) -> int | None:
    match = re.match(r"^\s*(\d{1,2})[:.](\d{2})", value or "")
    return int(match.group(1)) * 60 + int(match.group(2)) if match else None


def _checked(raw: dict[str, Any]) -> dict[str, Any] | None:
    checked = {
        "depart_time": _text(raw.get("depart_time"), 8),
        "arrive_time": _text(raw.get("arrive_time"), 8),
        "from_station": _text(raw.get("from_station"), 80),
        "to_station": _text(raw.get("to_station"), 80),
        "duration": _text(raw.get("duration"), 16),
    }
    if _clock(checked["depart_time"]) is None:
        return None
    # A train that only passes through one city reads as "Jaipur → Jaipur": not this route.
    same_station = checked["from_station"] and checked["from_station"].lower() == checked["to_station"].lower()
    return None if same_station or checked["depart_time"] == checked["arrive_time"] else checked


def check_option_sync(
    *, mode: str, option: dict[str, Any], from_city: str, to_city: str, day: date, api_key: str, models: list[str]
) -> dict[str, Any] | None:
    """Looks one candidate up again in a timetable: trains and flights by their number, buses in the
    operator's list of departures (kept only if one leaves within 10 minutes of the candidate). Returns
    the timetable's times and stations, or None when it doesn't run this route that day or can't be found."""
    raw = _ask_json(
        _check_prompt(mode, option, from_city, to_city, day),
        kind=dict, temperature=0.0, max_tokens=2048, api_key=api_key, models=models,
    )
    if raw.get("runs") is not True:
        return None
    if mode != "BUS":
        return _checked(raw)
    wanted = _clock(option.get("depart_time", ""))
    if wanted is None:
        return None
    for departure in raw.get("departures") or []:
        found = _checked(departure) if isinstance(departure, dict) else None
        if found and abs(_clock(found["depart_time"]) - wanted) <= 10:
            return found
    return None


def _text(value: Any, limit: int) -> str:
    return str(value or "").strip()[:limit]


def _clean(item: dict[str, Any]) -> dict[str, Any]:
    fare = item.get("fare_inr")
    try:
        fare = round(float(fare)) if fare not in (None, "") else None
    except (TypeError, ValueError):
        fare = None
    travel_class = _text(item.get("travel_class"), 40)
    return {
        "name": _text(item.get("name"), 80),
        "number": _text(item.get("number"), 24),
        "operator": _text(item.get("operator"), 80),
        "depart_time": _text(item.get("depart_time"), 8),
        "arrive_time": _text(item.get("arrive_time"), 8),
        "from_station": _text(item.get("from_station"), 80),
        "to_station": _text(item.get("to_station"), 80),
        "duration": _text(item.get("duration"), 16),
        "travel_class": travel_class if travel_class.lower() not in {"unknown", "n/a", "na", "null"} else "",
        "fare_inr": fare if fare and fare > 0 else None,
        "source": _text(item.get("source"), 16),  # "timetable" when it came from the railway timetable
    }
