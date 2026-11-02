from fastapi import APIRouter, Depends, HTTPException
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.rbac import get_current_claims, require_mfa, require_permission
from app.services import override_service as svc

# Admin override of stuck approvals (Admin -> Stuck items, and the Override panel on a claim) —
# see app.services.override_service. IT Admin by default; acting also needs a verified sign-in.
router = APIRouter(prefix="/admin/overrides", tags=["admin-overrides"])

_READ = [Depends(require_permission(svc.OVERRIDE_PERMISSION))]
_ACT = [Depends(require_permission(svc.OVERRIDE_PERMISSION)), Depends(require_mfa)]


class OverrideIn(BaseModel):
    action: str = Field(..., description="approve, reject, send_back, skip or approve_all")
    reason: str = Field(..., max_length=2000)


def _kind(kind: str) -> str:
    if kind not in svc.KINDS:
        raise HTTPException(status_code=404, detail="Unknown kind of item")
    return kind


@router.get("", dependencies=_READ)
async def waiting_items(db: AsyncSession = Depends(get_db)) -> list:
    """Every claim, travel request and relocation request waiting on an approver."""
    return jsonable_encoder(await svc.list_waiting(db))


@router.get("/{kind}/{item_id}", dependencies=_READ)
async def waiting_item(kind: str, item_id: int, db: AsyncSession = Depends(get_db)) -> dict | None:
    """Where one item is waiting (null when there's nothing to override)."""
    waiting = await svc.waiting_on(_kind(kind), item_id, db)
    return jsonable_encoder(waiting.out()) if waiting else None


@router.post("/{kind}/{item_id}", dependencies=_ACT)
async def override_item(
    kind: str,
    item_id: int,
    payload: OverrideIn,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> dict:
    after = await svc.override(_kind(kind), item_id, payload.action, payload.reason, int(claims["sub"]), db)
    return {"waiting": jsonable_encoder(after)}
