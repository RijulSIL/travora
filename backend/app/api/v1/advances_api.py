import csv
import io

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.rbac import require_role
from app.models.auth import Role
from app.schemas.workflow import AdvanceGrantIn, AdvanceRequestOut, AdvanceSettleIn, AdvanceUpdateIn
from app.services.advance_service import get_outstanding_advance
from app.services.workflow_service import (
    create_advance_grant,
    list_all_advances,
    list_archived_advances,
    settle_advance,
    update_advance_grant,
)

router = APIRouter(prefix="/advances", tags=["advances"])

# Advances are a Finance-only tool end to end — no other role (including Reporting Manager,
# HRBP, Payroll) ever creates, lists, or looks up an advance through this router, and delegation
# (which could otherwise stand in for Finance on approve_stage_4/process_payments) is deliberately
# excluded here too.
_finance_only = require_role(Role.FINANCE, allow_delegate=False)


@router.post("/grant", response_model=AdvanceRequestOut)
async def grant_advance(
    payload: AdvanceGrantIn,
    claims: dict = Depends(_finance_only),
    db: AsyncSession = Depends(get_db),
) -> AdvanceRequestOut:
    return await create_advance_grant(
        int(claims["sub"]),
        payload.employee_identifier,
        payload.amount,
        payload.purpose,
        db,
        confirm_merge=payload.confirm_merge,
    )


@router.put("/{advance_id}", response_model=AdvanceRequestOut)
async def edit_advance(
    advance_id: int,
    payload: AdvanceUpdateIn,
    claims: dict = Depends(_finance_only),
    db: AsyncSession = Depends(get_db),
) -> AdvanceRequestOut:
    return await update_advance_grant(int(claims["sub"]), advance_id, payload.amount, payload.purpose, db)


@router.get("", response_model=None)
async def list_advances(
    employee_user_id: int | None = Query(default=None),
    format: str | None = Query(default=None),
    claims: dict = Depends(_finance_only),
    db: AsyncSession = Depends(get_db),
) -> list[dict] | StreamingResponse:
    _ = claims
    rows = await list_all_advances(db, employee_user_id=employee_user_id)
    if (format or "").lower() == "csv":
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(
            [
                "id",
                "employee_id",
                "employee_name",
                "department",
                "granted_amount",
                "remaining_amount",
                "settled_amount",
                "purpose",
                "status",
                "granted_by",
                "created_at",
                "employee_outstanding_total",
            ]
        )
        for row in rows:
            writer.writerow(
                [
                    row["id"],
                    row["employee_id"],
                    row["employee_name"],
                    row["department"],
                    row["granted_amount"],
                    row["amount"],
                    row["settled_amount"],
                    row["purpose"],
                    row["status"],
                    row["created_by_name"],
                    row["created_at"],
                    row["employee_outstanding_total"],
                ]
            )
        output.seek(0)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": 'attachment; filename="advances.csv"'},
        )
    return rows


@router.get("/archived", response_model=None)
async def archived_advances(
    claims: dict = Depends(_finance_only),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    _ = claims
    return await list_archived_advances(db)


@router.get("/outstanding/{employee_user_id}", response_model=None)
async def outstanding_advance_for_employee(
    employee_user_id: int,
    claims: dict = Depends(_finance_only),
    db: AsyncSession = Depends(get_db),
) -> dict:
    _ = claims
    outstanding = await get_outstanding_advance(employee_user_id, db)
    return {"employee_user_id": employee_user_id, "outstanding_advance": str(outstanding)}


@router.post("/settle/{employee_user_id}", response_model=None)
async def settle_advance_for_employee(
    employee_user_id: int,
    payload: AdvanceSettleIn,
    claims: dict = Depends(_finance_only),
    db: AsyncSession = Depends(get_db),
) -> dict:
    outstanding = await settle_advance(int(claims["sub"]), employee_user_id, payload.amount, payload.note, db)
    return {"employee_user_id": employee_user_id, "outstanding_advance": str(outstanding)}
