from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.rbac import require_mfa, require_role
from app.models.auth import Role
from app.schemas.holiday import CompanyHolidayCreateIn, CompanyHolidayOut, CompanyHolidayUpdateIn
from app.services.holiday_service import (
    create_holiday,
    delete_holiday,
    list_holidays,
    update_holiday,
)

router = APIRouter(prefix="/admin", tags=["holiday-calendar"])

_IT_ADMIN_MFA = [Depends(require_role(Role.IT_ADMIN)), Depends(require_mfa)]


@router.get("/holidays", response_model=list[CompanyHolidayOut], dependencies=_IT_ADMIN_MFA)
async def list_company_holidays(db: AsyncSession = Depends(get_db)) -> list[CompanyHolidayOut]:
    return await list_holidays(db)


@router.post("/holidays", response_model=CompanyHolidayOut, dependencies=_IT_ADMIN_MFA)
async def create_company_holiday(
    payload: CompanyHolidayCreateIn, db: AsyncSession = Depends(get_db)
) -> CompanyHolidayOut:
    try:
        return await create_holiday(payload.holiday_date, payload.name, db)
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A holiday already exists on this date",
        ) from exc


@router.put("/holidays/{holiday_id}", response_model=CompanyHolidayOut, dependencies=_IT_ADMIN_MFA)
async def update_company_holiday(
    holiday_id: int, payload: CompanyHolidayUpdateIn, db: AsyncSession = Depends(get_db)
) -> CompanyHolidayOut:
    try:
        row = await update_holiday(
            holiday_id, payload.holiday_date, payload.name, db
        )
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A holiday already exists on this date",
        ) from exc
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Holiday not found")
    return row


@router.delete("/holidays/{holiday_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=_IT_ADMIN_MFA)
async def delete_company_holiday(holiday_id: int, db: AsyncSession = Depends(get_db)) -> None:
    ok = await delete_holiday(holiday_id, db)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Holiday not found")
