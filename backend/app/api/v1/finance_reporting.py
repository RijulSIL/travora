import csv
import io
import json
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.rbac import get_current_claims, require_any_permission, require_permission
from app.schemas.finance_reporting import (
    AuditLogOut,
    ERPLedgerEntryOut,
    ERPPostIn,
    ERPPostOut,
    ExceptionRequestLogOut,
    FinanceFilterParams,
    GstSummaryOut,
    PolicyViolationsOut,
    ReportScheduleIn,
    ReportScheduleOut,
)
from app.services.finance_reporting_service import (
    generate_report,
    generate_excel_report,
    generate_pdf_report,
    get_gst_summary,
    get_policy_violations,
    list_exception_requests_log,
    list_erp_ledger_entries,
    list_scheduled_reports,
    list_audit_logs,
    post_ledger_entry_to_erp,
    schedule_report,
)

router = APIRouter(tags=["finance-reporting"])

_EXCEPTION_QUEUE_ACCESS = Depends(
    require_any_permission("approve_stage_2", "approve_stage_4", "configure_policy", "approve_exception")
)


def _filters(
    from_date: date | None = Query(default=None),
    to_date: date | None = Query(default=None),
    department: str | None = Query(default=None),
    expense_category: str | None = Query(default=None),
    office_location: str | None = Query(default=None),
    employee_level: str | None = Query(default=None),
    impact_level: str | None = Query(default=None),
) -> FinanceFilterParams:
    return FinanceFilterParams(
        from_date=from_date,
        to_date=to_date,
        department=department,
        expense_category=expense_category,
        office_location=office_location,
        employee_level=employee_level,
        impact_level=impact_level,
    )


@router.get("/finance/gst-summary", response_model=GstSummaryOut)
async def gst_summary(
    filters: FinanceFilterParams = Depends(_filters),
    db: AsyncSession = Depends(get_db),
    _claims: dict = Depends(require_permission("view_reports")),
) -> dict:
    return await get_gst_summary(filters, db)


@router.get("/finance/gstr2b/export")
async def gstr2b_export(
    format: str = Query(default="csv", description="Format: csv, xlsx, pdf"),
    filters: FinanceFilterParams = Depends(_filters),
    db: AsyncSession = Depends(get_db),
    _claims: dict = Depends(require_permission("view_reports")),
) -> StreamingResponse:
    summary = await get_gst_summary(filters, db)
    rows = [{"metric": k, "value": str(v)} for k, v in summary.items()]
    
    fmt = format.lower()
    if fmt == "xlsx":
        content = generate_excel_report("gst_summary", rows)
        return StreamingResponse(
            io.BytesIO(content),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": 'attachment; filename="gst_summary.xlsx"'}
        )
    if fmt == "pdf":
        content = generate_pdf_report("gst_summary", rows)
        return StreamingResponse(
            io.BytesIO(content),
            media_type="application/pdf",
            headers={"Content-Disposition": 'attachment; filename="gst_summary.pdf"'}
        )
        
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["metric", "value"])
    for row in rows:
        writer.writerow([row["metric"], row["value"]])
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="gstr2b_export.csv"'},
    )


@router.post("/finance/erp/post", response_model=ERPPostOut)
async def erp_post(
    payload: ERPPostIn,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
    _perm: dict = Depends(require_permission("process_payments")),
) -> ERPPostOut:
    return await post_ledger_entry_to_erp(payload.claim_id, int(claims["sub"]), payload.erp_system, db)


@router.get("/finance/erp-ledger", response_model=list[ERPLedgerEntryOut])
async def list_erp_ledger(
    from_date: date | None = Query(default=None),
    to_date: date | None = Query(default=None),
    employee: str | None = Query(default=None),
    cost_centre: str | None = Query(default=None),
    status: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    _claims: dict = Depends(require_permission("view_reports")),
) -> list[ERPLedgerEntryOut]:
    return await list_erp_ledger_entries(
        from_date=from_date,
        to_date=to_date,
        employee=employee,
        cost_centre=cost_centre,
        status_value=status,
        db=db,
    )


@router.get("/audit/logs", response_model=list[AuditLogOut])
async def audit_logs(
    claim_id: str | None = Query(default=None),
    employee_id: str | None = Query(default=None),
    action: str | None = Query(default=None),
    actor: str | None = Query(default=None),
    from_date: date | None = Query(default=None),
    to_date: date | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    _claims: dict = Depends(require_permission("export_audit")),
) -> list[AuditLogOut]:
    return await list_audit_logs(
        claim_id=claim_id,
        employee_id=employee_id,
        action=action,
        actor=actor,
        from_date=from_date,
        to_date=to_date,
        db=db,
    )


@router.get("/audit/logs/export")
async def audit_logs_export(
    claim_id: str | None = Query(default=None),
    employee_id: str | None = Query(default=None),
    action: str | None = Query(default=None),
    actor: str | None = Query(default=None),
    from_date: date | None = Query(default=None),
    to_date: date | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    _claims: dict = Depends(require_permission("export_audit")),
) -> StreamingResponse:
    rows = await list_audit_logs(
        claim_id=claim_id,
        employee_id=employee_id,
        action=action,
        actor=actor,
        from_date=from_date,
        to_date=to_date,
        db=db,
    )
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["id", "timestamp", "entity_type", "entity_id", "action", "actor_id", "event_hash"])
    for row in rows:
        writer.writerow(
            [row.id, row.timestamp.isoformat(), row.entity_type, row.entity_id, row.action, row.actor_id, row.event_hash]
        )
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="audit_logs.csv"'},
    )


@router.get("/reports/policy-violations", response_model=PolicyViolationsOut)
async def policy_violations(
    from_date: date | None = Query(default=None),
    to_date: date | None = Query(default=None),
    department: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    _claims: dict = Depends(require_permission("view_reports")),
) -> dict:
    return await get_policy_violations(
        from_date=from_date,
        to_date=to_date,
        department=department,
        db=db,
    )


@router.get("/reports/exception-requests", response_model=list[ExceptionRequestLogOut])
async def exception_requests_log(
    status: str | None = Query(default=None),
    exception_type: str | None = Query(default=None),
    from_date: date | None = Query(default=None),
    to_date: date | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    _claims: dict = _EXCEPTION_QUEUE_ACCESS,
) -> list[dict]:
    return await list_exception_requests_log(
        status_value=status,
        exception_type=exception_type,
        from_date=from_date,
        to_date=to_date,
        db=db,
        current_user_id=int(_claims["sub"]),
    )


@router.post("/reports/schedule", response_model=ReportScheduleOut)
async def create_report_schedule(
    payload: ReportScheduleIn,
    claims: dict = Depends(get_current_claims),
    db: AsyncSession = Depends(get_db),
    _perm: dict = Depends(require_permission("view_reports")),
) -> ReportScheduleOut:
    return await schedule_report(payload, int(claims["sub"]), db)


@router.get("/reports/schedule", response_model=list[ReportScheduleOut])
async def get_report_schedules(
    db: AsyncSession = Depends(get_db),
    _claims: dict = Depends(require_permission("view_reports")),
) -> list[ReportScheduleOut]:
    return await list_scheduled_reports(db)


@router.get("/reports/{report_type}")
async def get_report(
    report_type: str,
    filters: FinanceFilterParams = Depends(_filters),
    db: AsyncSession = Depends(get_db),
    _claims: dict = Depends(require_permission("view_reports")),
) -> dict:
    return await generate_report(report_type, filters, db)


@router.get("/reports/{report_type}/export")
async def export_report(
    report_type: str,
    format: str = Query(default="csv", description="Format: csv, xlsx, pdf"),
    filters: FinanceFilterParams = Depends(_filters),
    db: AsyncSession = Depends(get_db),
    _claims: dict = Depends(require_permission("view_reports")),
) -> StreamingResponse:
    report = await generate_report(report_type, filters, db)
    rows = report.get("rows") or []
    
    fmt = format.lower()
    if fmt == "xlsx":
        content = generate_excel_report(report_type, rows)
        return StreamingResponse(
            io.BytesIO(content),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{report_type}.xlsx"'}
        )
    if fmt == "pdf":
        content = generate_pdf_report(report_type, rows)
        return StreamingResponse(
            io.BytesIO(content),
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{report_type}.pdf"'}
        )
        
    output = io.StringIO()
    if rows:
        fieldnames = list(rows[0].keys())
        writer = csv.DictWriter(output, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    else:
        output.write(json.dumps(report))
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{report_type}.csv"'},
    )


