"""Reads a travel ticket (PDF or image) with Gemini, for the Travel Desk's upload form: the PNR or
booking reference, who it's with, and the route and date it's for. Same models and key as
invoice extraction (invoice_gemini_extraction)."""

from __future__ import annotations

import json
import logging
from typing import Any

from google import genai
from google.genai import types

from app.services.invoice_gemini_extraction import _parse_json_response

logger = logging.getLogger(__name__)

TICKET_PROMPT = """\
You are reading a travel ticket or booking confirmation (flight, train or bus) from the attached file.
Return JSON with exactly these keys:
{
  "pnr": "the PNR / booking reference / ticket number the traveller would quote, or empty string",
  "provider": "who the journey is with, e.g. IndiGo, Air India, Indian Railways (IRCTC), a bus operator, or empty",
  "mode": "FLIGHT, TRAIN, BUS or empty",
  "from_city": "city the journey starts in (city name, not the station or airport code), or empty",
  "to_city": "city the journey ends in (city name), or empty",
  "travel_date": "YYYY-MM-DD date of departure, or empty",
  "confidence": 0-100
}
Rules:
- Indian Railways tickets: the 10-digit PNR is the pnr; provider is "Indian Railways (IRCTC)".
- Flights: use the airline's booking reference (PNR, usually 6 letters/digits), not the e-ticket number.
- If the document has several journeys, describe the first one.
- Use empty strings for anything you can't see. Never guess a PNR.
"""


def read_ticket_sync(file_bytes: bytes, content_type: str, *, api_key: str, models: list[str]) -> dict[str, Any]:
    """Tries each model in turn. Raises if none of them can read the ticket."""
    client = genai.Client(api_key=api_key)
    last_err: Exception | None = None
    for model in [m.strip() for m in models if m and m.strip()]:
        try:
            response = client.models.generate_content(
                model=model,
                contents=[
                    types.Part.from_bytes(data=file_bytes, mime_type=content_type),
                    types.Part.from_text(text=TICKET_PROMPT),
                ],
                config=types.GenerateContentConfig(
                    temperature=0.0,
                    max_output_tokens=2048,
                    response_mime_type="application/json",
                    thinking_config=types.ThinkingConfig(thinking_budget=512),
                ),
            )
            data = _parse_json_response(response.text or "")
            return {
                "pnr": str(data.get("pnr") or "").strip()[:128],
                "provider": str(data.get("provider") or "").strip()[:64],
                "mode": str(data.get("mode") or "").strip().upper()[:16],
                "from_city": str(data.get("from_city") or "").strip()[:128],
                "to_city": str(data.get("to_city") or "").strip()[:128],
                "travel_date": str(data.get("travel_date") or "").strip()[:10],
                "confidence": int(data.get("confidence") or 0),
            }
        except (json.JSONDecodeError, ValueError, TypeError) as e:
            last_err = e
            logger.warning("Ticket reading returned unusable JSON for model %s: %s", model, e)
        except Exception as e:  # noqa: BLE001 — any API failure: try the next model
            last_err = e
            logger.warning("Ticket reading failed for model %s: %s", model, e)
    raise RuntimeError(f"Couldn't read the ticket: {last_err}")
