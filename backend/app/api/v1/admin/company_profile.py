import json

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.encryption import decrypt_text, encrypt_text
from app.core.rbac import require_any_permission, require_mfa, require_permission
from app.models.expense_category import CompanyProfile
from app.schemas.common import CompanyProfileIn, CompanyProfileOut

router = APIRouter(prefix="/admin/company-profile", tags=["admin-company-profile"])

_READ_COMPANY_PROFILE = [Depends(require_permission("view_sensitive_admin"))]
_WRITE_COMPANY_PROFILE = [Depends(require_permission("configure_policy")), Depends(require_mfa)]


def _serialize(profile: CompanyProfile) -> CompanyProfileOut:
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
    )


@router.get("", response_model=CompanyProfileOut | None, dependencies=_READ_COMPANY_PROFILE)
async def get_company_profile(db: AsyncSession = Depends(get_db)) -> CompanyProfileOut | None:
    profile = (await db.execute(select(CompanyProfile))).scalar_one_or_none()
    return _serialize(profile) if profile else None


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
    await db.commit()
    await db.refresh(profile)
    return _serialize(profile)
