import json
import re

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.encryption import decrypt_text, encrypt_text
from app.core.rbac import get_current_claims, require_mfa, require_permission
from app.models.expense_category import CompanyProfile
from app.schemas.common import CompanyProfileIn, CompanyProfileOut
from app.services.audit_service import log_event
from app.services.department_service import (
    DEFAULT_DEPARTMENTS,
    clean_department_name,
    department_counts,
    match_department,
    removal_blocked_message,
    rename_department,
    validate_department_list,
)
from app.services.office_service import (
    clean_office_name,
    match_office,
    office_counts,
    rename_office,
    validate_office_list,
)

router = APIRouter(prefix="/admin/company-profile", tags=["admin-company-profile"])

_READ_COMPANY_PROFILE = [Depends(require_permission("view_sensitive_admin"))]
_WRITE_COMPANY_PROFILE = [Depends(require_permission("configure_policy")), Depends(require_mfa)]

# 2-digit state code, 10-character PAN, entity number, Z, check character.
_GSTIN = re.compile(r"^(0[1-9]|[1-3][0-9]|97|99)[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")
# 4-letter bank code, 0, 6-character branch code.
_IFSC = re.compile(r"^[A-Z]{4}0[A-Z0-9]{6}$")


def _bank_of(profile: CompanyProfile | None) -> dict | None:
    decrypted = decrypt_text(profile.bank_details) if profile else None
    return json.loads(decrypted) if decrypted else None


async def _serialize(profile: CompanyProfile, db: AsyncSession) -> CompanyProfileOut:
    return CompanyProfileOut(
        id=profile.id,
        company_name=profile.company_name,
        gstins=profile.gstins or [],
        office_locations=profile.office_locations or [],
        bank_details=_bank_of(profile),
        departments=list(profile.departments) if profile.departments is not None else list(DEFAULT_DEPARTMENTS),
        department_counts=await department_counts(db),
        office_counts=await office_counts(db),
        travel_agent_email=profile.travel_agent_email,
    )


def _clean_gstins(gstins: list[str]) -> list[str]:
    cleaned: list[str] = []
    for raw in gstins:
        gstin = re.sub(r"\s+", "", raw or "").upper()
        if not gstin or gstin in cleaned:
            continue
        if not _GSTIN.match(gstin):
            raise HTTPException(
                status_code=422,
                detail=f"{gstin} isn't a valid GSTIN — a GSTIN has 15 characters, like 27AAACS1234F1Z5",
            )
        cleaned.append(gstin)
    return cleaned


def _clean_bank(bank: dict | None) -> dict:
    bank = dict(bank or {})
    for field in ("account_name", "account_number", "ifsc"):
        bank[field] = (bank.get(field) or "").strip()
    bank["account_number"] = re.sub(r"\s+", "", bank["account_number"])
    bank["ifsc"] = bank["ifsc"].upper()
    if bank["ifsc"] and not _IFSC.match(bank["ifsc"]):
        raise HTTPException(
            status_code=422,
            detail=f"{bank['ifsc']} isn't a valid IFSC — an IFSC has 11 characters, like HDFC0001234",
        )
    return bank


def _masked_bank(bank: dict | None) -> dict | None:
    # The audit log keeps only the last 4 digits of the account number.
    if not bank:
        return bank
    number = bank.get("account_number") or ""
    return {**bank, "account_number": f"••••{number[-4:]}" if number else ""}


@router.get("", response_model=CompanyProfileOut | None, dependencies=_READ_COMPANY_PROFILE)
async def get_company_profile(db: AsyncSession = Depends(get_db)) -> CompanyProfileOut | None:
    profile = (await db.execute(select(CompanyProfile))).scalar_one_or_none()
    return await _serialize(profile, db) if profile else None


@router.put("", response_model=CompanyProfileOut, dependencies=_WRITE_COMPANY_PROFILE)
async def put_company_profile(
    payload: CompanyProfileIn,
    db: AsyncSession = Depends(get_db),
    claims: dict = Depends(get_current_claims),
) -> CompanyProfileOut:
    company_name = (payload.company_name or "").strip()
    if not company_name:
        raise HTTPException(status_code=422, detail="Enter the company name")
    gstins = _clean_gstins(payload.gstins)
    bank = _clean_bank(payload.bank_details)
    offices = validate_office_list(payload.office_locations)

    profile = (await db.execute(select(CompanyProfile))).scalar_one_or_none()
    stored_departments = profile.departments if profile is not None else None
    stored_bank = _bank_of(profile) or {}
    bank_before = {field: stored_bank.get(field) or "" for field in ("account_name", "account_number", "ifsc")}
    before = {
        "company_name": profile.company_name if profile else None,
        "gstins": list(profile.gstins or []) if profile else [],
        "office_locations": list(profile.office_locations or []) if profile else [],
        "departments": list(stored_departments) if stored_departments is not None else list(DEFAULT_DEPARTMENTS),
        "travel_agent_email": profile.travel_agent_email if profile else None,
    }
    if profile is None:
        profile = CompanyProfile(company_name=company_name)
        db.add(profile)

    # Renames move the people in the office to the new name. The old name can also be an office
    # people are in that wasn't on the list.
    known_offices = before["office_locations"] + list(await office_counts(db))
    for old, new in payload.office_renames.items():
        old_name = match_office(old, known_offices)
        new_name = match_office(new, offices)
        if old_name is None or new_name is None:
            raise HTTPException(
                status_code=422,
                detail=f"Couldn't rename {clean_office_name(old)} to {clean_office_name(new)}",
            )
        await rename_office(old_name, new_name, db)

    profile.company_name = company_name
    profile.gstins = gstins
    profile.office_locations = offices
    profile.bank_details = encrypt_text(json.dumps(bank))
    profile.travel_agent_email = payload.travel_agent_email or None

    if payload.departments is not None:
        departments = validate_department_list(payload.departments)
        # Renames move the people in the department, its head and its team budget along.
        for old, new in payload.department_renames.items():
            old_name = match_department(old, before["departments"])
            new_name = match_department(new, departments)
            if old_name is None or new_name is None:
                raise HTTPException(
                    status_code=422,
                    detail=f"Couldn't rename {clean_department_name(old)} to {clean_department_name(new)}",
                )
            await rename_department(old_name, new_name, db)
        # People still in a department taken off the list would be left in one that isn't there.
        blocked = await removal_blocked_message(before["departments"], departments, db)
        if blocked:
            raise HTTPException(status_code=422, detail=blocked)
        profile.departments = departments

    after = {
        "company_name": profile.company_name,
        "gstins": gstins,
        "office_locations": offices,
        "departments": list(profile.departments) if profile.departments is not None else list(DEFAULT_DEPARTMENTS),
        "travel_agent_email": profile.travel_agent_email,
    }
    changed = [field for field in after if after[field] != before[field]]
    old_value = {field: before[field] for field in changed}
    new_value = {field: after[field] for field in changed}
    if {field: bank.get(field, "") for field in bank_before} != bank_before:
        old_value["bank_details"] = _masked_bank(bank_before)
        new_value["bank_details"] = _masked_bank(bank)
    if old_value or new_value or payload.office_renames or payload.department_renames:
        if payload.office_renames:
            new_value["office_renames"] = dict(payload.office_renames)
        if payload.department_renames:
            new_value["department_renames"] = dict(payload.department_renames)
        await db.flush()
        await log_event(
            entity_type="company_profile",
            entity_id=str(profile.id),
            action="update_company_profile",
            actor_id=int(claims["sub"]) if isinstance(claims, dict) and claims.get("sub") else None,
            old=old_value,
            new=new_value,
            db=db,
        )

    await db.commit()
    await db.refresh(profile)
    return await _serialize(profile, db)
