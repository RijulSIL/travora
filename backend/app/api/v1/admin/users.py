import csv
import io

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.rbac import get_current_claims, require_mfa, require_permission
from app.models.auth import Role, User
from app.models.employee import Employee
from app.models.policy import ImpactLevel
from app.schemas.common import (
    AdminBulkImportSummaryOut,
    AdminUserCreateIn,
    AdminUserOut,
    AdminUserUpdateIn,
    UserOut,
    UserRoleUpdateIn,
)
from app.services.audit_service import log_event
from app.services.auth_service import hash_password

router = APIRouter(prefix="/admin", tags=["admin-users"])


@router.get(
    "/users",
    dependencies=[Depends(require_permission("manage_users")), Depends(require_mfa)],
    response_model=list[AdminUserOut],
)
async def list_users(
    role: Role | None = Query(default=None),
    department: str | None = Query(default=None),
    impact_level_id: int | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> list[AdminUserOut]:
    statement = select(User, Employee).outerjoin(Employee, Employee.employee_id == User.employee_id)


    if role:
        statement = statement.where(User.role == role)
    if department:
        statement = statement.where(Employee.department == department)
    if impact_level_id:
        statement = statement.where(Employee.impact_level_id == impact_level_id)
    statement = statement.order_by(User.id.desc()).offset(offset).limit(limit)

    result = await db.execute(statement)
    all_rows = result.all()
    rows: list[AdminUserOut] = []
    for user, employee in all_rows:



        rows.append(
            AdminUserOut(
                user_id=user.id,
                email=user.email,
                full_name=user.full_name or (employee.full_name if employee else None),
                role=user.role,
                mfa_verified=user.mfa_verified,
                is_active=user.is_active,
                employee_id=user.employee_id,
                department=employee.department if employee else None,
                impact_level_id=employee.impact_level_id if employee else None,
                office_location=employee.office_location if employee else None,
                reporting_manager_id=employee.reporting_manager_id if employee else None,
            )
        )
    return rows


@router.get(
    "/impact-levels",
    dependencies=[Depends(require_permission("manage_users")), Depends(require_mfa)],
)
async def list_impact_levels(db: AsyncSession = Depends(get_db)):
    from datetime import date

    from app.services.policy_engine import get_active_policy_version
    
    try:
        policy = await get_active_policy_version(date.today(), db)
        result = await db.execute(
            select(ImpactLevel)
            .where(ImpactLevel.policy_version_id == policy.id)
            .order_by(ImpactLevel.id)
        )
        return [{"id": level.id, "level_code": level.level_code, "level_name": level.level_name} for level in result.scalars().all()]
    except Exception:
        # Fallback to returning all levels if no active policy found for today
        result = await db.execute(select(ImpactLevel).order_by(ImpactLevel.id))
        return [{"id": level.id, "level_code": level.level_code, "level_name": level.level_name} for level in result.scalars().all()]


@router.get(
    "/reporting-managers",
    dependencies=[Depends(require_permission("manage_users")), Depends(require_mfa)],
    response_model=list[dict],
)
async def list_reporting_managers(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(User)
        .outerjoin(Employee, User.employee_id == Employee.employee_id)
        .outerjoin(ImpactLevel, Employee.impact_level_id == ImpactLevel.id)
        .where(
            or_(
                User.role.in_([Role.REPORTING_MANAGER, Role.CEO]),
                ImpactLevel.level_code == "L1"
            )
        )
        .order_by(User.full_name)
    )
    users = result.scalars().all()
    return [{"employee_id": u.employee_id, "full_name": u.full_name or u.email} for u in users if u.employee_id]


@router.post(
    "/users/create",
    dependencies=[Depends(require_permission("manage_users")), Depends(require_mfa)],
    response_model=UserOut,
    status_code=status.HTTP_201_CREATED,
)
async def admin_create_user(
    payload: AdminUserCreateIn,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> User:
    normalized_email = payload.email.strip().lower()
    if not normalized_email:
        raise HTTPException(status_code=422, detail="Email is required")
    if not payload.password or len(payload.password) < 8:
        raise HTTPException(
            status_code=422, detail="Password must be at least 8 characters long"
        )

    existing = await db.execute(select(User).where(User.email == normalized_email))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="A user with this email already exists")

    employee_id = payload.employee_id.strip() if payload.employee_id else None
    if employee_id:
        existing_employee_user = await db.execute(
            select(User).where(User.employee_id == employee_id)
        )
        if existing_employee_user.scalar_one_or_none() is not None:
            raise HTTPException(
                status_code=409, detail="A user with this employee ID already exists"
            )

        employee = await db.get(Employee, employee_id)
        if employee is None:
            employee = Employee(
                employee_id=employee_id,
                full_name=payload.full_name or normalized_email,
                is_active=True,
                impact_level_id=payload.impact_level_id,
                reporting_manager_id=payload.reporting_manager_id,
                department=payload.department,
            )
            db.add(employee)
        else:
            if payload.full_name:
                employee.full_name = payload.full_name
            if payload.impact_level_id:
                employee.impact_level_id = payload.impact_level_id
            if payload.reporting_manager_id:
                employee.reporting_manager_id = payload.reporting_manager_id
            if payload.department:
                employee.department = payload.department
            employee.is_active = True
        
        await db.flush()

    user = User(
        email=normalized_email,
        full_name=payload.full_name,
        hashed_password=hash_password(payload.password),
        role=payload.role,
        mfa_verified=payload.mfa_verified,
        is_active=True,
        employee_id=employee_id,
    )
    db.add(user)
    await db.flush()

    await log_event(
        entity_type="user",
        entity_id=str(user.id),
        action="user_created_by_admin",
        actor_id=int(claims["sub"]),
        old=None,
        new={
            "email": user.email,
            "role": user.role.value,
            "employee_id": user.employee_id,
        },
        db=db,
    )
    await db.commit()
    await db.refresh(user)
    return user

@router.put(
    "/users/{user_id}",
    dependencies=[Depends(require_permission("manage_users")), Depends(require_mfa)],
    response_model=UserOut,
)
async def admin_update_user(
    user_id: int,
    payload: AdminUserUpdateIn,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> User:
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
        
    if payload.full_name is not None:
        user.full_name = payload.full_name
    if payload.role is not None:
        user.role = payload.role
        
    if user.employee_id:
        employee = await db.get(Employee, user.employee_id)
        if employee:
            if payload.full_name is not None:
                employee.full_name = payload.full_name
            if payload.impact_level_id is not None:
                employee.impact_level_id = payload.impact_level_id
            if payload.department is not None:
                employee.department = payload.department
            if payload.office_location is not None:
                employee.office_location = payload.office_location
            if payload.reporting_manager_id is not None:
                employee.reporting_manager_id = payload.reporting_manager_id
                
    await db.commit()
    await db.refresh(user)
    return user


@router.put(
    "/users/{user_id}/role",
    dependencies=[Depends(require_permission("manage_users")), Depends(require_mfa)],
)
async def change_user_role(
    user_id: int,
    payload: UserRoleUpdateIn,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    old_role = user.role
    user.role = payload.role
    await log_event(
        entity_type="user",
        entity_id=str(user_id),
        action="role_changed",
        actor_id=int(claims["sub"]),
        old={"role": old_role.value},
        new={"role": payload.role.value},
        db=db,
    )
    await db.commit()
    return {"status": "updated"}


@router.delete(
    "/users/{user_id}",
    dependencies=[Depends(require_permission("manage_users")), Depends(require_mfa)],
)
async def deactivate_user(user_id: int, db: AsyncSession = Depends(get_db)) -> dict[str, str]:
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    user.is_active = False
    if user.employee_id:
        employee = await db.get(Employee, user.employee_id)
        if employee:
            employee.is_active = False
    await db.commit()
    return {"status": "inactive"}


@router.post(
    "/users/bulk-import",
    dependencies=[Depends(require_permission("manage_users")), Depends(require_mfa)],
    response_model=AdminBulkImportSummaryOut,
    status_code=status.HTTP_201_CREATED,
)
async def bulk_import_users(
    file: UploadFile = File(...),
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=422, detail="Only CSV files are supported")

    raw = await file.read()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=422, detail="CSV must be UTF-8 encoded") from exc

    reader = csv.DictReader(io.StringIO(text))
    required = {"employee_id", "full_name", "email", "role", "department", "office_location"}
    if not reader.fieldnames or not required.issubset({h.strip() for h in reader.fieldnames if h}):
        raise HTTPException(status_code=422, detail=f"CSV must include columns: {', '.join(sorted(required))}")

    errors: list[dict] = []
    created = 0
    actor_id = int(claims["sub"])

    existing_users = (await db.execute(select(User))).scalars().all()
    existing_emails = {u.email.lower() for u in existing_users}
    existing_emp_ids = {u.employee_id for u in existing_users if u.employee_id}

    for idx, row in enumerate(reader, start=2):
        employee_id = (row.get("employee_id") or "").strip() or None
        full_name = (row.get("full_name") or "").strip() or None
        email = (row.get("email") or "").strip().lower()
        role_raw = (row.get("role") or "").strip().upper()
        department = (row.get("department") or "").strip() or None
        office_location = (row.get("office_location") or "").strip() or None
        impact_level_id_raw = (row.get("impact_level_id") or "").strip() or None
        impact_level_id = int(impact_level_id_raw) if impact_level_id_raw and impact_level_id_raw.isdigit() else None
        if not email:
            errors.append({"row": idx, "employee_id": employee_id, "email": None, "error": "email is required"})
            continue
        if role_raw not in {r.value for r in Role}:
            errors.append(
                {"row": idx, "employee_id": employee_id, "email": email, "error": f"invalid role: {role_raw}"}
            )
            continue
        if email in existing_emails:
            errors.append({"row": idx, "employee_id": employee_id, "email": email, "error": "email already exists"})
            continue
        if employee_id and employee_id in existing_emp_ids:
            errors.append(
                {"row": idx, "employee_id": employee_id, "email": email, "error": "employee_id already exists"}
            )
            continue

        employee = await db.get(Employee, employee_id) if employee_id else None
        if employee_id and employee is None:
            employee = Employee(
                employee_id=employee_id,
                full_name=full_name or email,
                department=department,
                office_location=office_location,
                is_active=True,
                impact_level_id=impact_level_id,
            )
            db.add(employee)
        elif employee:
            employee.full_name = full_name or employee.full_name
            employee.department = department or employee.department
            employee.office_location = office_location or employee.office_location
            if impact_level_id:
                employee.impact_level_id = impact_level_id
            employee.is_active = True

        user = User(
            email=email,
            full_name=full_name,
            role=Role(role_raw),
            mfa_verified=False,
            is_active=True,
            employee_id=employee_id,
            hashed_password=hash_password("Welcome@123"),
        )
        db.add(user)
        await db.flush()
        await log_event(
            entity_type="user",
            entity_id=str(user.id),
            action="user_bulk_imported",
            actor_id=actor_id,
            old=None,
            new={"email": email, "role": role_raw, "employee_id": employee_id},
            db=db,
        )
        created += 1
        existing_emails.add(email)
        if employee_id:
            existing_emp_ids.add(employee_id)

    await db.commit()
    return {"created": created, "failed": len(errors), "errors": errors}
