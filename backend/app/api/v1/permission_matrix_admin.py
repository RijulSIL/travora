from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.rbac import get_current_claims, require_mfa, require_permission
from app.schemas.permission_config import PermissionMatrixConfigOut, PermissionMatrixConfigUpdate
from app.services.permission_config_service import (
    get_permission_config,
    permission_catalog,
    save_permission_config,
)

router = APIRouter(prefix="/admin/permission-matrix", tags=["permission-matrix"])

_READ = [Depends(require_permission("view_permission_matrix"))]
_WRITE = [Depends(require_permission("edit_permission_matrix")), Depends(require_mfa)]


@router.get("", response_model=PermissionMatrixConfigOut, dependencies=_READ)
async def get_permission_matrix(db: AsyncSession = Depends(get_db)) -> dict:
    cfg = await get_permission_config(db)
    return {"config": cfg, "catalog": permission_catalog()}


@router.put("", response_model=PermissionMatrixConfigOut, dependencies=_WRITE)
async def put_permission_matrix(
    payload: PermissionMatrixConfigUpdate,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> dict:
    cfg = await save_permission_config(payload.config, int(claims["sub"]), db)
    return {"config": cfg}
