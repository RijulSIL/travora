"""Admin management of the travel request form's dropdowns (Project Code, Trip Purpose)."""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.rbac import get_current_claims, require_any_permission, require_mfa, require_permission
from app.models.travel_request import (
    ProjectNotificationRecipient,
    TravelOptionType,
    TravelRequestOption,
)
from app.schemas.travel_request import (
    ProjectRecipientIn,
    ProjectRecipientOut,
    ProjectRecipientUpdateIn,
    TravelOptionIn,
    TravelOptionOut,
    TravelOptionUpdateIn,
)
from app.services import travel_request_service as svc
from app.services.audit_service import log_event, row_snapshot

router = APIRouter(prefix="/admin/travel-options", tags=["admin-travel-options"])

_READ_TRAVEL_OPTIONS = [Depends(require_any_permission("configure_policy", "view_admin_readonly"))]
_WRITE_TRAVEL_OPTIONS = [Depends(require_permission("configure_policy")), Depends(require_mfa)]


async def _audit(entity_type: str, item, action: str, claims: dict, old: dict | None, db: AsyncSession) -> None:
    """Audit row for a travel option / project recipient change. Call before committing."""
    await db.flush()
    await log_event(
        entity_type=entity_type,
        entity_id=str(item.id),
        action=action,
        actor_id=int(claims["sub"]),
        old=old,
        new=None if action.endswith("_deleted") else row_snapshot(item),
        db=db,
    )


def _parse_option_type(raw: str) -> TravelOptionType:
    try:
        return TravelOptionType(raw.strip().upper())
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"option_type must be one of: {', '.join(t.value for t in TravelOptionType)}",
        ) from exc


@router.get("", response_model=list[TravelOptionOut], dependencies=_READ_TRAVEL_OPTIONS)
async def list_travel_options(
    option_type: str | None = Query(None), db: AsyncSession = Depends(get_db)
) -> list[TravelRequestOption]:
    """Every option, deactivated ones included (the request form itself only gets the active
    ones, via GET /travel-requests/options)."""
    rows = await svc.list_travel_options(db, include_inactive=True)
    if option_type:
        wanted = _parse_option_type(option_type).value
        rows = [r for r in rows if r.option_type == wanted]
    return rows


@router.post("", response_model=TravelOptionOut, dependencies=_WRITE_TRAVEL_OPTIONS)
async def create_travel_option(
    payload: TravelOptionIn, db: AsyncSession = Depends(get_db), claims: dict = Depends(get_current_claims)
) -> TravelRequestOption:
    option_type = _parse_option_type(payload.option_type)
    value = payload.value.strip()
    if not value:
        raise HTTPException(status_code=422, detail="value is required")
    existing = await db.scalar(
        select(TravelRequestOption).where(
            TravelRequestOption.option_type == option_type.value, TravelRequestOption.value == value
        )
    )
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"'{value}' already exists"
            + (" (deactivated — re-activate it instead)" if not existing.is_active else ""),
        )
    item = TravelRequestOption(
        option_type=option_type.value,
        value=value,
        label=(payload.label or "").strip() or value,
        is_active=True,
    )
    db.add(item)
    await _audit("travel_option", item, "travel_option_created", claims, None, db)
    await db.commit()
    await db.refresh(item)
    return item


@router.put("/{item_id}", response_model=TravelOptionOut, dependencies=_WRITE_TRAVEL_OPTIONS)
async def update_travel_option(
    item_id: int,
    payload: TravelOptionUpdateIn,
    db: AsyncSession = Depends(get_db),
    claims: dict = Depends(get_current_claims),
) -> TravelRequestOption:
    """Edit an option's value / label or retire it via `is_active`. Requests store the value as
    plain text and keep the one they were raised with — a rename only changes what new requests
    get, and is written to the audit log (old and new value), which is how an old value is traced
    to the renamed option (travel_request_service.find_travel_option). A renamed project code
    keeps its notification recipients: they're settings, not history, so they move to the new code."""
    item = await db.get(TravelRequestOption, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Travel option not found")
    before = row_snapshot(item)
    new_value = (payload.value or item.value).strip()
    renamed = new_value != item.value
    if renamed:
        clash = await db.scalar(
            select(TravelRequestOption.id).where(
                TravelRequestOption.option_type == item.option_type,
                TravelRequestOption.value == new_value,
                TravelRequestOption.id != item.id,
            )
        )
        if clash is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"'{new_value}' already exists")
        if item.option_type == TravelOptionType.PROJECT_CODE.value:
            await db.execute(
                update(ProjectNotificationRecipient)
                .where(ProjectNotificationRecipient.project_code == item.value)
                .values(project_code=new_value)
            )
        item.value = new_value
    item.label = payload.label.strip()
    item.is_active = payload.is_active
    item.notify_project_stakeholders = payload.notify_project_stakeholders
    action = "travel_option_renamed" if renamed else "travel_option_updated"
    await _audit("travel_option", item, action, claims, before, db)
    await db.commit()
    await db.refresh(item)
    return item


@router.get(
    "/project-recipients",
    response_model=list[ProjectRecipientOut],
    dependencies=_READ_TRAVEL_OPTIONS,
)
async def list_project_recipients(
    project_code: str = Query(..., min_length=1), db: AsyncSession = Depends(get_db)
) -> list[ProjectNotificationRecipient]:
    rows = (
        await db.execute(
            select(ProjectNotificationRecipient)
            .where(ProjectNotificationRecipient.project_code == project_code)
            .order_by(ProjectNotificationRecipient.id)
        )
    ).scalars().all()
    return rows


@router.post(
    "/project-recipients",
    response_model=ProjectRecipientOut,
    dependencies=_WRITE_TRAVEL_OPTIONS,
)
async def create_project_recipient(
    payload: ProjectRecipientIn, db: AsyncSession = Depends(get_db), claims: dict = Depends(get_current_claims)
) -> ProjectNotificationRecipient:
    email = payload.email.strip().lower()
    existing = await db.scalar(
        select(ProjectNotificationRecipient.id).where(
            ProjectNotificationRecipient.project_code == payload.project_code,
            ProjectNotificationRecipient.email == email,
        )
    )
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"'{email}' is already a recipient for this project code",
        )
    item = ProjectNotificationRecipient(
        project_code=payload.project_code,
        email=email,
        display_name=(payload.display_name or "").strip() or None,
    )
    db.add(item)
    await _audit("project_recipient", item, "project_recipient_created", claims, None, db)
    await db.commit()
    await db.refresh(item)
    return item


@router.put(
    "/project-recipients/{item_id}",
    response_model=ProjectRecipientOut,
    dependencies=_WRITE_TRAVEL_OPTIONS,
)
async def update_project_recipient(
    item_id: int,
    payload: ProjectRecipientUpdateIn,
    db: AsyncSession = Depends(get_db),
    claims: dict = Depends(get_current_claims),
) -> ProjectNotificationRecipient:
    item = await db.get(ProjectNotificationRecipient, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Recipient not found")
    before = row_snapshot(item)
    email = payload.email.strip().lower()
    if email != item.email:
        clash = await db.scalar(
            select(ProjectNotificationRecipient.id).where(
                ProjectNotificationRecipient.project_code == item.project_code,
                ProjectNotificationRecipient.email == email,
                ProjectNotificationRecipient.id != item_id,
            )
        )
        if clash is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"'{email}' is already a recipient for this project code",
            )
    item.email = email
    item.display_name = (payload.display_name or "").strip() or None
    await _audit("project_recipient", item, "project_recipient_updated", claims, before, db)
    await db.commit()
    await db.refresh(item)
    return item


@router.delete("/project-recipients/{item_id}", dependencies=_WRITE_TRAVEL_OPTIONS)
async def delete_project_recipient(
    item_id: int, db: AsyncSession = Depends(get_db), claims: dict = Depends(get_current_claims)
) -> dict[str, str]:
    item = await db.get(ProjectNotificationRecipient, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Recipient not found")
    before = row_snapshot(item)
    await db.delete(item)
    await _audit("project_recipient", item, "project_recipient_deleted", claims, before, db)
    await db.commit()
    return {"status": "deleted"}
