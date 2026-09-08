from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.rbac import get_current_claims, require_any_permission, require_mfa, require_permission
from app.schemas.workflow import WorkflowConfigOut, WorkflowConfigUpdate
from app.services.workflow_service import get_workflow_config, save_workflow_config

router = APIRouter(prefix="/workflow", tags=["workflow"])

_READ_WORKFLOW = [Depends(require_any_permission("configure_policy", "view_workflow_config"))]
_WRITE_WORKFLOW = [Depends(require_permission("edit_workflow_config")), Depends(require_mfa)]


@router.get("/config", response_model=WorkflowConfigOut, dependencies=_READ_WORKFLOW)
async def get_config(db: AsyncSession = Depends(get_db)) -> dict:
    cfg = await get_workflow_config(db)
    return {"config": cfg}


@router.put("/config", response_model=WorkflowConfigOut, dependencies=_WRITE_WORKFLOW)
async def put_config(
    payload: WorkflowConfigUpdate,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> dict:
    cfg = await save_workflow_config(payload.config, int(claims["sub"]), db)
    return {"config": cfg}
