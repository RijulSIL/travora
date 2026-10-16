from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.encoders import jsonable_encoder
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.rbac import get_current_claims, require_permission
from app.services import relocation_service as svc

# Relocation approvals for relocation reimbursement claims — see app.models.relocation. Employees
# reach this from New Claim -> Travel Claim (trip purpose "Relocation"); approvers act on it from
# the Relocation tab of Pending Approvals, decided by the Relocation Approval workflow's stage roles.
router = APIRouter(prefix="/relocation", tags=["relocation"])


class RelocationRequestIn(BaseModel):
    origin_city: str = Field(..., max_length=128)
    destination_city: str = Field(..., max_length=128)
    estimated_amount: str
    planned_move_date: str
    family_members: int | None = None
    notes: str | None = Field(default=None, max_length=2000)


class RelocationDecisionIn(BaseModel):
    comment: str | None = Field(default=None, max_length=2000)


class RelocationRejectIn(BaseModel):
    reason: str = Field(..., min_length=1, max_length=2000)


@router.get("/mine", dependencies=[Depends(require_permission("submit_claim"))])
async def my_relocations(claims: dict = Depends(get_current_claims), db: AsyncSession = Depends(get_db)) -> list:
    return jsonable_encoder(await svc.list_my_relocations(int(claims["sub"]), db))


@router.post("/requests", dependencies=[Depends(require_permission("submit_claim"))])
async def create_request(
    payload: RelocationRequestIn,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> dict:
    row = await svc.create_relocation_request(int(claims["sub"]), payload.model_dump(), db)
    return jsonable_encoder(await svc.relocation_summary(row, db))


@router.post("/prior-approvals", dependencies=[Depends(require_permission("submit_claim"))])
async def upload_prior_approval(
    origin_city: str = Form(...),
    destination_city: str = Form(...),
    approved_amount: str | None = Form(default=None),
    file: UploadFile = File(...),
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> dict:
    row = await svc.create_prior_approval(int(claims["sub"]), origin_city, destination_city, approved_amount, file, db)
    return jsonable_encoder(await svc.relocation_summary(row, db))


@router.get("/pending")
async def pending_for_me(claims: dict = Depends(get_current_claims), db: AsyncSession = Depends(get_db)) -> list:
    """Relocation requests currently waiting on the caller (any role — it's the workflow's stage
    roles that decide who can act, not a permission)."""
    return jsonable_encoder(await svc.list_pending_for_approver(int(claims["sub"]), db))


@router.post("/requests/{request_id}/approve")
async def approve(
    request_id: int,
    payload: RelocationDecisionIn,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> dict:
    return jsonable_encoder(await svc.approve_relocation(request_id, int(claims["sub"]), payload.comment, db))


@router.post("/requests/{request_id}/reject")
async def reject(
    request_id: int,
    payload: RelocationRejectIn,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> dict:
    return jsonable_encoder(await svc.reject_relocation(request_id, int(claims["sub"]), payload.reason, db))


@router.get("/requests/{request_id}/evidence")
async def evidence(
    request_id: int,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> FileResponse:
    row = await svc.evidence_file_for(request_id, int(claims["sub"]), db)
    return FileResponse(row.evidence_path, media_type=row.evidence_content_type, filename=row.evidence_filename)
