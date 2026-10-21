import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.encryption import decrypt_text, encrypt_text
from app.core.rbac import require_mfa, require_permission
from app.models.expense_category import CompanyProfile
from app.schemas.common import CompanyProfileIn, CompanyProfileOut
from app.services.department_service import (
    DEFAULT_DEPARTMENTS,
    clean_department_name,
    department_counts,
    match_department,
    rename_department,
    validate_department_list,
)

router = APIRouter(prefix="/admin/company-profile", tags=["admin-company-profile"])

_READ_COMPANY_PROFILE = [Depends(require_permission("view_sensitive_admin"))]
_WRITE_COMPANY_PROFILE = [Depends(require_permission("configure_policy")), Depends(require_mfa)]


async def _serialize(profile: CompanyProfile, db: AsyncSession) -> CompanyProfileOut:
    bank_details = None
    decrypted = decrypt_text(profile.bank_details)
    if decrypted:
        bank_details = json.loads(decrypted)
    return CompanyProfileOut(
        id=profile.id,
        company_name=profile.company_name,
        gstins=profile.gstins or [],
        office_locations=profile.office_locations or [],
        bank_details=bank_details,
        departments=list(profile.departments) if profile.departments is not None else list(DEFAULT_DEPARTMENTS),
        department_counts=await department_counts(db),
    )


@router.get("", response_model=CompanyProfileOut | None, dependencies=_READ_COMPANY_PROFILE)
async def get_company_profile(db: AsyncSession = Depends(get_db)) -> CompanyProfileOut | None:
    profile = (await db.execute(select(CompanyProfile))).scalar_one_or_none()
    return await _serialize(profile, db) if profile else None


@router.put("", response_model=CompanyProfileOut, dependencies=_WRITE_COMPANY_PROFILE)
async def put_company_profile(
    payload: CompanyProfileIn, db: AsyncSession = Depends(get_db)
) -> CompanyProfileOut:
    profile = (await db.execute(select(CompanyProfile))).scalar_one_or_none()
    encrypted_bank = encrypt_text(json.dumps(payload.bank_details or {}))
    if profile is None:
        profile = CompanyProfile(
            company_name=payload.company_name,
            gstins=payload.gstins,
            office_locations=payload.office_locations,
            bank_details=encrypted_bank,
        )
        db.add(profile)
    else:
        profile.company_name = payload.company_name
        profile.gstins = payload.gstins
        profile.office_locations = payload.office_locations
        profile.bank_details = encrypted_bank

    if payload.departments is not None:
        departments = validate_department_list(payload.departments)
        before = list(profile.departments) if profile.departments is not None else list(DEFAULT_DEPARTMENTS)
        # Renames move the people in the department, its head and its team budget along.
        for old, new in payload.department_renames.items():
            old_name = match_department(old, before)
            new_name = match_department(new, departments)
            if old_name is None or new_name is None:
                raise HTTPException(
                    status_code=422,
                    detail=f"Couldn't rename {clean_department_name(old)} to {clean_department_name(new)}",
                )
            await rename_department(old_name, new_name, db)
        profile.departments = departments

    await db.commit()
    await db.refresh(profile)
    return await _serialize(profile, db)
