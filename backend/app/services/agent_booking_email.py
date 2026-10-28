"""The email the company's travel agent gets when the Travel Desk sends them a trip to book: the
trip at a glance, each leg with what the traveller asked for, and one button to the booking link.
Email-client safe: tables and inline styles only (no flex/grid, no external CSS or images)."""

from __future__ import annotations

from datetime import date
from html import escape

BRAND = "#116149"
BRAND_DARK = "#0b4434"
INK = "#1f2a37"
MUTED = "#64748b"
LINE = "#e5e9ee"
SOFT = "#f6f8f7"

TIME_WINDOW_LABELS = {
    "NIGHT": "12 AM–6 AM",
    "MORNING": "6 AM–12 PM",
    "AFTERNOON": "12 PM–6 PM",
    "EVENING": "6 PM–12 AM",
}
BUS_TYPE_LABELS = {
    "AC_SLEEPER": "AC sleeper",
    "AC_SEATER": "AC seater",
    "NON_AC_SLEEPER": "Non-AC sleeper",
    "NON_AC_SEATER": "Non-AC seater",
    "VOLVO": "Volvo",
}
TRIP_TYPE_LABELS = {"ONE_WAY": "One way", "ROUND_TRIP": "Round trip", "MULTI_CITY": "Multi-city"}
MODE_LABELS = {"TRAIN": "Train", "FLIGHT": "Flight", "BUS": "Bus"}


def _day(d: date | None) -> str:
    return d.strftime("%a, %d %b %Y") if d else "Date to be confirmed"


def _windows(codes) -> str:
    return ", ".join(TIME_WINDOW_LABELS[c] for c in TIME_WINDOW_LABELS if c in set(codes or []))


def pick_lines(pick: dict | None) -> list[str]:
    """What the traveller asked for on one leg, as short plain sentences (already safe text)."""
    if not pick:
        return []
    lines: list[str] = []
    choice = pick.get("choice")
    option = pick.get("option") or {}
    if choice == "bus":
        kinds = ", ".join(BUS_TYPE_LABELS.get(b, b) for b in pick.get("bus_types") or []) or "Any bus"
        lines.append(f"Bus: {kinds}")
    elif choice == "own":
        if pick.get("note"):
            lines.append(f"“{pick['note']}”")
    elif option:
        name = " ".join(x for x in (option.get("name") or option.get("operator"), option.get("number")) if x)
        times = " → ".join(t for t in (option.get("depart_time"), option.get("arrive_time")) if t)
        extra = " · ".join(x for x in (times, option.get("travel_class")) if x)
        lines.append(f"Picked: {name}" + (f" · {extra}" if extra else ""))
    when = _windows(pick.get("time_windows"))
    if when:
        lines.append(f"Wants to leave {when}")
    return lines


def _leg_rows(legs: list[dict]) -> str:
    rows = []
    for i, leg in enumerate(legs):
        top = "" if i == 0 else f"border-top:1px solid {LINE};"
        prefs = "".join(
            f'<div style="font-size:13px;line-height:19px;color:{INK};margin-top:4px;">{escape(line)}</div>'
            for line in pick_lines(leg.get("pick"))
        )
        pref_block = (
            f'<div style="margin-top:10px;padding:10px 12px;background:{SOFT};border-radius:8px;">'
            f'<div style="font-size:10px;line-height:14px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:{BRAND};">Traveller asked for</div>'
            f"{prefs}</div>"
            if prefs
            else ""
        )
        rows.append(
            f"""
            <tr><td style="padding:16px 20px;{top}">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
                <td style="vertical-align:top;">
                  <div style="font-size:11px;line-height:16px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:{MUTED};">{escape(leg['label'])} · {escape(MODE_LABELS.get(leg['mode'], leg['mode'].title()))}</div>
                  <div style="font-size:17px;line-height:24px;font-weight:700;color:{INK};margin-top:2px;">{escape(leg['from_city'] or '—')} &rarr; {escape(leg['to_city'] or '—')}</div>
                  <div style="font-size:13px;line-height:19px;color:{MUTED};margin-top:1px;">{escape(_day(leg.get('travel_date')))}</div>
                </td>
              </tr></table>
              {pref_block}
            </td></tr>"""
        )
    return "".join(rows)


def _fact(label: str, value: str, top: bool) -> str:
    border = f"border-top:1px solid {LINE};" if top else ""
    return (
        f'<tr><td style="padding:10px 0;{border}width:120px;vertical-align:top;font-size:13px;line-height:19px;color:{MUTED};">{escape(label)}</td>'
        f'<td style="padding:10px 0;{border}vertical-align:top;font-size:13px;line-height:19px;color:{INK};font-weight:600;">{value}</td></tr>'
    )


def _eligibility_html(text: str) -> str:
    """'Impact level L6C; Eligible flight cabins: …; Eligible train classes: ….' as stacked lines."""
    parts = [p.strip().rstrip(".") for p in text.split(";") if p.strip()]
    parts = [p.replace("Eligible flight cabins:", "Flights:").replace("Eligible train classes:", "Trains:") for p in parts]
    return "<br>".join(escape(p) for p in parts)


def build_agent_booking_email(
    *,
    company_name: str,
    reference: str,
    traveller: str,
    trip_type: str,
    legs: list[dict],
    eligibility: str,
    notes: str | None,
    link: str,
) -> tuple[str, str, str]:
    """(subject, plain text, html). `legs`: [{label, mode, from_city, to_city, travel_date, pick}]."""
    first = legs[0] if legs else {}
    route = f"{first.get('from_city') or '—'} → {first.get('to_city') or '—'}"
    subject = f"Tickets needed: {traveller}, {route} — {reference}"
    trip = TRIP_TYPE_LABELS.get(trip_type, trip_type.replace("_", " ").title())
    preheader = f"{reference} · {traveller} · {route} · {_day(first.get('travel_date'))}"

    text_lines = [
        f"{company_name} needs tickets booked.",
        "",
        f"Reference: {reference}",
        f"Traveller: {traveller}",
        f"Trip: {trip}",
        f"Eligible for: {eligibility}",
        "",
    ]
    for leg in legs:
        text_lines.append(f"{leg['label']} ({MODE_LABELS.get(leg['mode'], leg['mode'])}): {leg['from_city']} -> {leg['to_city']}, {_day(leg.get('travel_date'))}")
        text_lines += [f"  {line}" for line in pick_lines(leg.get("pick"))]
    if notes:
        text_lines += ["", f"Traveller's notes: {notes}"]
    text_lines += [
        "",
        f"Book the tickets and upload them here (no login needed): {link}",
        "",
        "This link is for this trip only. If the Travel Desk sends a new one, this link stops working.",
    ]
    text = "\n".join(text_lines)

    notes_block = (
        f"""
        <tr><td style="padding:0 32px 24px 32px;">
          <div style="padding:14px 16px;border-left:3px solid {BRAND};background:{SOFT};border-radius:0 8px 8px 0;">
            <div style="font-size:10px;line-height:14px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:{BRAND};">Notes from the traveller</div>
            <div style="font-size:14px;line-height:21px;color:{INK};margin-top:4px;">{escape(notes)}</div>
          </div>
        </td></tr>"""
        if notes
        else ""
    )

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>{escape(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#eef2f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#eef2f0;">{escape(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef2f0;">
<tr><td align="center" style="padding:32px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid {LINE};">

    <tr><td bgcolor="{BRAND}" style="background:{BRAND};background-image:linear-gradient(135deg,{BRAND} 0%,{BRAND_DARK} 100%);padding:22px 32px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="font-size:20px;line-height:26px;font-weight:800;color:#ffffff;letter-spacing:-0.3px;">Travora</td>
        <td align="right" style="font-size:11px;line-height:16px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#bfe3d6;">{escape(company_name)}</td>
      </tr></table>
    </td></tr>

    <tr><td style="padding:30px 32px 6px 32px;">
      <div style="display:inline-block;padding:4px 10px;border-radius:999px;background:#e7f3ee;color:{BRAND};font-size:11px;line-height:16px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;">Booking request · {escape(reference)}</div>
      <h1 style="margin:14px 0 0 0;font-size:24px;line-height:31px;font-weight:800;color:{INK};letter-spacing:-0.4px;">Tickets needed for {escape(traveller)}</h1>
      <p style="margin:8px 0 0 0;font-size:15px;line-height:23px;color:{MUTED};">Please book the trip below and upload each ticket through the secure link. No login or password is needed.</p>
    </td></tr>

    <tr><td style="padding:20px 32px 8px 32px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        {_fact("Traveller", escape(traveller), False)}
        {_fact("Trip", escape(trip), True)}
        {_fact("Eligible for", _eligibility_html(eligibility), True)}
      </table>
    </td></tr>

    <tr><td style="padding:16px 32px 8px 32px;">
      <div style="font-size:11px;line-height:16px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:{MUTED};margin-bottom:8px;">Itinerary</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid {LINE};border-radius:10px;">
        {_leg_rows(legs)}
      </table>
    </td></tr>

    <tr><td style="height:16px;line-height:16px;font-size:0;">&nbsp;</td></tr>
    {notes_block}

    <tr><td align="center" style="padding:4px 32px 10px 32px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td bgcolor="{BRAND}" style="border-radius:10px;">
          <a href="{escape(link, quote=True)}" style="display:inline-block;padding:15px 34px;font-size:16px;line-height:20px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">Book &amp; upload tickets &rarr;</a>
        </td>
      </tr></table>
      <p style="margin:14px 0 0 0;font-size:12px;line-height:18px;color:{MUTED};">Button not working? Copy this link into your browser:<br>
        <a href="{escape(link, quote=True)}" style="color:{BRAND};word-break:break-all;">{escape(link)}</a></p>
    </td></tr>

    <tr><td style="padding:18px 32px 30px 32px;">
      <div style="padding:12px 14px;background:#fff8eb;border:1px solid #f5dfb3;border-radius:8px;font-size:12px;line-height:18px;color:#7a5512;">
        <b>This link is for this trip only.</b> If the Travel Desk sends you a new link for it, this one stops working.
      </div>
    </td></tr>

    <tr><td style="padding:18px 32px;background:{SOFT};border-top:1px solid {LINE};font-size:12px;line-height:18px;color:{MUTED};text-align:center;">
      Sent by the {escape(company_name)} Travel Desk through Travora.<br>This is an automated email; replies to it aren't monitored.
    </td></tr>

  </table>
</td></tr>
</table>
</body>
</html>"""
    return subject, text, html
