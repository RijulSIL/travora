"""Invoice OCR / field extraction via Gemini API (primary + fallback models)."""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from google import genai
from google.genai import types

logger = logging.getLogger(__name__)

_JSON_FENCE = re.compile(r"```(?:json)?\s*([\s\S]*?)\s*```", re.IGNORECASE)

EXTRACTION_PROMPT = """\
You are parsing an Indian business expense invoice or receipt from the attached file.
Return JSON with this exact structure:
{
  "fields": {
    "vendor_name": {"value": "string", "confidence": 0-100},
    "supplier_gstin": {"value": "15 character GSTIN or empty string", "confidence": 0-100},
    "company_gstin": {"value": "buyer GSTIN if visible else empty", "confidence": 0-100},
    "invoice_number": {"value": "string", "confidence": 0-100},
    "invoice_date": {"value": "YYYY-MM-DD if known", "confidence": 0-100},
    "place_of_supply": {"value": "2-digit state code if known", "confidence": 0-100},
    "payment_mode": {"value": "Card|Cash|UPI|Other|unknown", "confidence": 0-100},
    "currency": {"value": "INR or other ISO code", "confidence": 0-100},
    "grand_total": {"value": "decimal string, no currency symbol", "confidence": 0-100},
    "total_taxable_value": {"value": "decimal string", "confidence": 0-100},
    "cgst": {"value": "decimal string", "confidence": 0-100},
    "sgst": {"value": "decimal string", "confidence": 0-100},
    "igst": {"value": "decimal string", "confidence": 0-100},
    "is_tatkal": {"value": "true or false", "confidence": 0-100}
  },
  "line_items": [
    {
      "description": "line description",
      "quantity": "1.00",
      "unit": "EA",
      "unit_price": "decimal",
      "taxable_value": "decimal",
      "tax_rate": "18.00",
      "cgst": "decimal",
      "sgst": "decimal",
      "igst": "decimal",
      "total_amount": "decimal",
      "category_hint": "one of: hotel, food, travel, conveyance, incidental"
    }
  ]
}
Rules:
- Use empty string "" and low confidence if a value is not visible.
- line_items: use one summary row if the document only shows totals; otherwise list itemized rows.
- All monetary values as strings with dot decimal separator.
- If IGST applies, cgst and sgst may be 0 and igst non-zero.
- If the document shows a generic "GST" or "Tax" amount without specifying CGST/SGST/IGST, place the full tax amount into "igst".
- For electronic tickets (such as IRCTC e-tickets) showing a Transaction ID or online booking details, if the specific payment method (Card/UPI) is not explicitly named, default the payment_mode to "Other" with high confidence (95%).
"""


def _parse_json_response(text: str) -> dict[str, Any]:
    text = (text or "").strip()
    m = _JSON_FENCE.search(text)
    if m:
        text = m.group(1).strip()
    return json.loads(text)


def _generate_sync(client: genai.Client, model: str, file_bytes: bytes, mime_type: str) -> str:
    response = client.models.generate_content(
        model=model,
        contents=[
            types.Part.from_bytes(data=file_bytes, mime_type=mime_type),
            types.Part.from_text(text=EXTRACTION_PROMPT),
        ],
        config=types.GenerateContentConfig(
            temperature=0.1,
            max_output_tokens=8192,
            response_mime_type="application/json",
        ),
    )
    if not response.text:
        raise RuntimeError("empty model response")
    return response.text


def extract_invoice_with_gemini_sync(
    file_bytes: bytes,
    content_type: str,
    *,
    api_key: str,
    primary_model: str,
    fallback_model: str,
) -> dict[str, Any]:
    """Try primary_model, then fallback_model. Raises if both fail."""
    client = genai.Client(api_key=api_key)
    last_err: Exception | None = None
    for model in (primary_model, fallback_model):
        name = (model or "").strip()
        if not name:
            continue
        try:
            raw = _generate_sync(client, name, file_bytes, content_type)
            data = _parse_json_response(raw)
            return normalize_extraction_dict(data)
        except Exception as e:
            last_err = e
            logger.warning("Gemini invoice extraction failed for model %s: %s", name, e)
    raise RuntimeError(f"Gemini extraction failed for all configured models: {last_err}")


def normalize_extraction_dict(data: dict[str, Any]) -> dict[str, Any]:
    out = dict(data)
    if "fields" not in out or not isinstance(out["fields"], dict):
        out["fields"] = {}
    if "line_items" not in out or not isinstance(out["line_items"], list):
        out["line_items"] = []
    return out
