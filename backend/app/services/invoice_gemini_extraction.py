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
    "place_of_supply": {"value": "2-digit GST state code (see rules below)", "confidence": 0-100},
    "payment_mode": {"value": "Card|Cash|UPI|Other|unknown", "confidence": 0-100},
    "currency": {"value": "INR or other ISO code", "confidence": 0-100},
    "grand_total": {"value": "decimal string, no symbol, original currency", "confidence": 0-100},
    "grand_total_inr_estimate": {"value": "grand_total converted to INR; empty if INR", "confidence": 0-100},
    "total_taxable_value": {"value": "decimal string", "confidence": 0-100},
    "cgst": {"value": "decimal string", "confidence": 0-100},
    "sgst": {"value": "decimal string", "confidence": 0-100},
    "igst": {"value": "decimal string", "confidence": 0-100},
    "is_tatkal": {"value": "true or false", "confidence": 0-100},
    "expense_category": {"value": "see expense_category rule below", "confidence": 0-100}
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
      "category_hint": "see category_hint rule below"
    }
  ]
}
Rules:
- expense_category: classify what this bill/invoice is actually for — a corporate expense
  reimbursement system uses this to report spend by type. Pick the single best-fitting option
  based on the vendor name and line items (not the filename), from: Hotel/Accommodation, Air
  Travel, Train Travel, Bus Travel, Local Conveyance, Fuel, Food & Meals, Software/Subscription,
  Office Supplies, Telecom & Internet, Professional Services, Courier & Postage, Other. Use
  "Other" only when genuinely none of the listed options fit.
- category_hint (per line item): same idea as expense_category but one short lowercase token per
  line, from: hotel, food, air, train, bus, conveyance, fuel, software, office_supplies, telecom,
  professional, courier, incidental.
- Use empty string "" and low confidence if a value is not visible.
- line_items: use one summary row if the document only shows totals; otherwise list itemized rows.
- All monetary values as strings with dot decimal separator.
- If IGST applies, cgst and sgst may be 0 and igst non-zero.
- If the document shows a generic "GST" or "Tax" amount without specifying CGST/SGST/IGST, place the full tax amount into "igst".
- For electronic tickets (such as IRCTC e-tickets) showing a Transaction ID or online booking details, if the specific payment method (Card/UPI) is not explicitly named, default the payment_mode to "Other" with high confidence (95%).
- place_of_supply: it is a 2-digit numeric GST state code, never a state name or abbreviation.
  Derive it in this order: (1) if the invoice explicitly prints a "Place of Supply" field, map
  that state name to its code using the table below; (2) otherwise, if a supplier_gstin is
  visible, use its first 2 digits as the code (that is exactly what they represent); (3)
  otherwise leave place_of_supply as an empty string with low confidence rather than guessing.
  GST state code table: 01 Jammu & Kashmir, 02 Himachal Pradesh, 03 Punjab, 04 Chandigarh,
  05 Uttarakhand, 06 Haryana, 07 Delhi, 08 Rajasthan, 09 Uttar Pradesh, 10 Bihar, 11 Sikkim,
  12 Arunachal Pradesh, 13 Nagaland, 14 Manipur, 15 Mizoram, 16 Tripura, 17 Meghalaya, 18 Assam,
  19 West Bengal, 20 Jharkhand, 21 Odisha, 22 Chhattisgarh, 23 Madhya Pradesh, 24 Gujarat,
  25 Daman & Diu, 26 Dadra & Nagar Haveli, 27 Maharashtra, 29 Karnataka, 30 Goa, 31 Lakshadweep,
  32 Kerala, 33 Tamil Nadu, 34 Puducherry, 35 Andaman & Nicobar Islands, 36 Telangana,
  37 Andhra Pradesh, 38 Ladakh, 97 Other Territory.
- If currency is not INR: grand_total stays in the original currency; separately estimate the
  INR equivalent in grand_total_inr_estimate using your best general knowledge of a typical
  exchange rate around the invoice date (approximate, not a live rate). Always set
  grand_total_inr_estimate's confidence to 40 or lower — it is an estimate a human must verify.
- If currency is INR (or unclear), leave grand_total_inr_estimate as an empty string with confidence 0.
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
            # Gemini 2.5 models spend part of max_output_tokens on internal "thinking"
            # before writing any visible output — on a multi-page or visually complex
            # document that reasoning alone can consume nearly the whole budget (observed
            # 7861 of 8192 tokens on one 3-page receipt+invoice combo), truncating the JSON
            # mid-object with no room left to finish it. Capping it leaves the budget for
            # the actual answer.
            thinking_config=types.ThinkingConfig(thinking_budget=1024),
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
        # A malformed-JSON response is usually sampling variance rather than a model
        # that's genuinely incapable of this document — one immediate retry on the same
        # model resolves it far more often than falling straight through to the next
        # (possibly less accurate) model.
        for attempt in range(2):
            try:
                raw = _generate_sync(client, name, file_bytes, content_type)
                data = _parse_json_response(raw)
                return normalize_extraction_dict(data)
            except json.JSONDecodeError as e:
                last_err = e
                logger.warning(
                    "Gemini invoice extraction returned malformed JSON for model %s (attempt %d): %s",
                    name, attempt + 1, e,
                )
                continue
            except Exception as e:
                last_err = e
                logger.warning("Gemini invoice extraction failed for model %s: %s", name, e)
                break
    raise RuntimeError(f"Gemini extraction failed for all configured models: {last_err}")


def normalize_extraction_dict(data: dict[str, Any]) -> dict[str, Any]:
    out = dict(data)
    if "fields" not in out or not isinstance(out["fields"], dict):
        out["fields"] = {}
    if "line_items" not in out or not isinstance(out["line_items"], list):
        out["line_items"] = []
    return out
