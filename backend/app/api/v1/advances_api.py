import csv
import io

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.rbac import require_any_permission, require_permission
from app.schemas.workflow import AdvanceRequestIn, AdvanceRequestOut

router = APIRouter(prefix="/advances", tags=["advances"])

_ADVANCES_MSG = "Advance requests are not offered."


def _advances_gone() -> None:
    raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail=_ADVANCES_MSG)


@router.post("/request", response_model=AdvanceRequestOut)
async def request_advance(
    payload: AdvanceRequestIn,
    claims: dict = Depends(require_permission("submit_claim")),
    db: AsyncSession = Depends(get_db),
) -> AdvanceRequestOut:
    _ = payload, claims, db
    _advances_gone()


@router.get("", response_model=list[AdvanceRequestOut])
async def list_my_advances(
    claims: dict = Depends(require_permission("submit_claim")),
    db: AsyncSession = Depends(get_db),
) -> list[AdvanceRequestOut]:
    _ = claims, db
    _advances_gone()


@router.get("/outstanding", response_model=None)
async def outstanding_advances(
    format: str | None = Query(default=None),
    claims: dict = Depends(
        require_any_permission("approve_stage_2", "approve_stage_3", "process_payments")
    ),
    db: AsyncSession = Depends(get_db),
) -> list[dict] | StreamingResponse:
    _ = format, claims, db
    if (format or "").lower() == "csv":
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["message"])
        writer.writerow([_ADVANCES_MSG])
        output.seek(0)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": 'attachment; filename="advances_unavailable.csv"'},
        )
    _advances_gone()


@router.post("/{advance_id}/approve", response_model=AdvanceRequestOut)
async def approve_advance(
    advance_id: int,
    claims: dict = Depends(
        require_any_permission(
            "approve_stage_1",
            "approve_stage_2",
            "approve_stage_3",
            "process_payments",
        )
    ),
    db: AsyncSession = Depends(get_db),
) -> AdvanceRequestOut:
    _ = advance_id, claims, db
    _advances_gone()
