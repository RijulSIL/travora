"""Excel download of a policy version's expense limits (Expense limits page -> Download Excel)."""

import io
import re
from datetime import date

import xlsxwriter
from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timezone import now_ist, today_ist
from app.models.policy import CityGroup, CityGroupTier, ExpenseLimit, ImpactLevel, PolicyVersion

# (column title, model field prefix), in the order the page shows them.
_CAPS = [("Hotel", "hotel"), ("Food", "food"), ("Incidentals", "incidental"), ("Day visit", "day_visit")]


def _level_sort_key(code: str) -> list:
    """L1, L2, L3A, L3B, ... L6D — numbers compared as numbers, the rest as text."""
    return [int(part) if part.isdigit() else part for part in re.split(r"(\d+)", code or "")]


def _day(value: date | None) -> str:
    return value.strftime("%d %b %Y") if value else "not set"


def _version_line(version: PolicyVersion) -> str:
    status = version.status.value if hasattr(version.status, "value") else str(version.status)
    if version.effective_from is None:
        when = "not scheduled yet"
    elif version.effective_to:
        when = f"in effect {_day(version.effective_from)} to {_day(version.effective_to)}"
    else:
        when = f"in effect from {_day(version.effective_from)}"
    return f"Policy version {version.version_number} · {status.replace('_', ' ').title()} · {when}"


async def build_expense_limits_workbook(policy_version_id: int, db: AsyncSession) -> tuple[bytes, str]:
    """Returns (xlsx bytes, file name) for every level × city group limit in this version."""
    version = await db.get(PolicyVersion, policy_version_id)
    if version is None:
        raise HTTPException(status_code=404, detail="Policy version not found")

    levels = (
        (await db.execute(select(ImpactLevel).where(ImpactLevel.policy_version_id == policy_version_id)))
        .scalars()
        .all()
    )
    levels = sorted(levels, key=lambda lvl: _level_sort_key(lvl.level_code))
    limits = (
        (await db.execute(select(ExpenseLimit).where(ExpenseLimit.policy_version_id == policy_version_id)))
        .scalars()
        .all()
    )
    by_key = {(lim.impact_level_id, lim.city_group): lim for lim in limits}
    tiers = (await db.execute(select(CityGroupTier).order_by(CityGroupTier.id))).scalars().all()
    # A deprecated group only matters here if this version still has limits for it.
    used = {lim.city_group for lim in limits}
    tiers = [t for t in tiers if not t.is_deprecated or t.code in used]

    today = today_ist()
    cities = (
        (
            await db.execute(
                select(CityGroup)
                .where(
                    CityGroup.effective_from <= today,
                    or_(CityGroup.effective_to.is_(None), CityGroup.effective_to >= today),
                )
                .order_by(CityGroup.city_name)
            )
        )
        .scalars()
        .all()
    )

    output = io.BytesIO()
    wb = xlsxwriter.Workbook(output, {"in_memory": True})
    title = wb.add_format({"bold": True, "font_size": 14})
    muted = wb.add_format({"font_color": "#64748B"})
    head = wb.add_format(
        {
            "bold": True,
            "bg_color": "#E8F3EF",
            "font_color": "#116149",
            "border": 1,
            "border_color": "#CBD5E1",
            "text_wrap": True,
            "valign": "vcenter",
        }
    )
    text = wb.add_format({"border": 1, "border_color": "#E2E8F0"})
    level_fmt = wb.add_format({"bold": True, "border": 1, "border_color": "#E2E8F0"})
    money = wb.add_format({"num_format": "₹#,##0.00", "border": 1, "border_color": "#E2E8F0"})
    none_fmt = wb.add_format({"font_color": "#94A3B8", "italic": True, "border": 1, "border_color": "#E2E8F0"})
    strict = wb.add_format({"font_color": "#BE123C", "bold": True, "border": 1, "border_color": "#E2E8F0"})
    flagged = wb.add_format({"font_color": "#64748B", "border": 1, "border_color": "#E2E8F0"})

    # --- Sheet 1: every limit ---------------------------------------------------------------
    ws = wb.add_worksheet("Expense limits")
    ws.write(0, 0, "Expense limits", title)
    ws.write(1, 0, _version_line(version), muted)
    ws.write(2, 0, f"Downloaded {now_ist().strftime('%d %b %Y, %H:%M')} IST", muted)
    ws.write(
        3,
        0,
        "Strict: can't be exceeded without an approved exception. Flagged: can be exceeded, but is flagged for review. "
        "No cap: no limit set.",
        muted,
    )
    header_row = 5
    headers = ["Level", "Level name", "City group"]
    for label, _ in _CAPS:
        headers += [f"{label} (₹)", f"{label} rule"]
    for col, h in enumerate(headers):
        ws.write(header_row, col, h, head)
    ws.set_row(header_row, 30)

    row = header_row + 1
    for level in levels:
        for tier in tiers:
            lim = by_key.get((level.id, tier.code))
            ws.write(row, 0, level.level_code, level_fmt)
            ws.write(row, 1, level.level_name, text)
            ws.write(row, 2, f"{tier.display_name}{' (deprecated)' if tier.is_deprecated else ''}", text)
            col = 3
            for _, field in _CAPS:
                cap = getattr(lim, f"{field}_cap", None) if lim else None
                if cap is None:
                    ws.write(row, col, "No cap", none_fmt)
                    ws.write(row, col + 1, "", text)
                else:
                    ws.write_number(row, col, float(cap), money)
                    hard = bool(getattr(lim, f"{field}_is_hard_block", False))
                    ws.write(row, col + 1, "Strict" if hard else "Flagged", strict if hard else flagged)
                col += 2
            row += 1
    if row == header_row + 1:
        ws.write(row, 0, "This version has no impact levels yet.", none_fmt)

    ws.set_column(0, 0, 9)
    ws.set_column(1, 1, 24)
    ws.set_column(2, 2, 18)
    for i in range(len(_CAPS)):
        ws.set_column(3 + i * 2, 3 + i * 2, 15)
        ws.set_column(4 + i * 2, 4 + i * 2, 11)
    ws.freeze_panes(header_row + 1, 3)
    if row > header_row + 1:
        ws.autofilter(header_row, 0, row - 1, len(headers) - 1)

    # --- Sheet 2: which cities are in each group ---------------------------------------------
    cs = wb.add_worksheet("City groups")
    cs.write(0, 0, "City groups", title)
    cs.write(
        1,
        0,
        f"Cities in each group as of {today.strftime('%d %b %Y')}. Any city not listed uses the default group.",
        muted,
    )
    for col, h in enumerate(["City group", "Default", "Cities"]):
        cs.write(3, col, h, head)
    for i, tier in enumerate(tiers, start=4):
        names = [c.city_name for c in cities if c.group_type == tier.code]
        cs.write(i, 0, f"{tier.display_name}{' (deprecated)' if tier.is_deprecated else ''}", level_fmt)
        cs.write(i, 1, "Yes" if tier.is_default else "", text)
        cs.write(i, 2, ", ".join(names) if names else "None listed", text if names else none_fmt)
    cs.set_column(0, 0, 20)
    cs.set_column(1, 1, 9)
    cs.set_column(2, 2, 90)

    wb.close()
    safe_version = re.sub(r"[^A-Za-z0-9.]+", "-", version.version_number).strip("-") or str(version.id)
    return output.getvalue(), f"expense-limits-v{safe_version}-{today.isoformat()}.xlsx"
