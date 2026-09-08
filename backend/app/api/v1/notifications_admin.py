from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.rbac import get_current_claims, require_mfa, require_role
from app.models.auth import Role
from app.models.claim_workflow import NotificationTemplate
from app.schemas.workflow import (
    NotificationOut,
    NotificationReadAllOut,
    NotificationTemplateOut,
    NotificationTemplateUpdate,
    NotificationUnreadCountOut,
)
from app.services.notification_service import (
    list_notifications,
    mark_all_read,
    mark_read,
    unread_count,
)

router = APIRouter(prefix="/notifications", tags=["notifications"])

_TEMPLATE_ADMIN = [Depends(require_role(Role.HRBP_HR, Role.IT_ADMIN)), Depends(require_mfa)]
_TEMPLATE_UPDATE_ADMIN = [Depends(require_role(Role.IT_ADMIN)), Depends(require_mfa)]


@router.get("", response_model=list[NotificationOut])
async def list_my_notifications(
    limit: int = 20,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> list[NotificationOut]:
    return await list_notifications(int(claims["sub"]), db, limit=limit)


@router.get("/unread-count", response_model=NotificationUnreadCountOut)
async def get_unread_count(
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> NotificationUnreadCountOut:
    count = await unread_count(int(claims["sub"]), db)
    return NotificationUnreadCountOut(count=count)


@router.post("/{notification_id}/read", response_model=NotificationOut)
async def mark_notification_read(
    notification_id: int,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> NotificationOut:
    return await mark_read(notification_id, int(claims["sub"]), db)


@router.post("/read-all", response_model=NotificationReadAllOut)
async def mark_notifications_read_all(
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> NotificationReadAllOut:
    marked = await mark_all_read(int(claims["sub"]), db)
    return NotificationReadAllOut(marked_count=marked)


@router.get(
    "/templates",
    response_model=list[NotificationTemplateOut],
    dependencies=_TEMPLATE_ADMIN,
)
async def list_templates(db: AsyncSession = Depends(get_db)) -> list[NotificationTemplate]:
    result = await db.execute(select(NotificationTemplate).order_by(NotificationTemplate.id))
    return list(result.scalars().all())


@router.put(
    "/templates/{template_id}",
    response_model=NotificationTemplateOut,
    dependencies=_TEMPLATE_UPDATE_ADMIN,
)
async def update_template(
    template_id: int,
    payload: NotificationTemplateUpdate,
    db: AsyncSession = Depends(get_db),
) -> NotificationTemplate:
    row = await db.get(NotificationTemplate, template_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    if payload.subject is not None:
        row.subject = payload.subject
    if payload.body_text is not None:
        row.body_text = payload.body_text
    await db.commit()
    await db.refresh(row)
    return row
