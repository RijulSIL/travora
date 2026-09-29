import calendar
import csv
import io
import logging
from datetime import date, datetime, timedelta
from decimal import Decimal
from uuid import uuid4

import xlsxwriter
from fastapi import HTTPException
from fpdf import FPDF
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import User
from app.models.claim_workflow import ClaimApprovalStage, ExceptionApproval, ExceptionRequest
from app.models.employee import AuditLog, Employee
from app.models.finance import ERPLedgerEntry, ERPPostStatus, ScheduledReport, ScheduleFrequency
from app.models.policy import ImpactLevel
from app.models.reimbursement import (
    ClaimDraft,
    ClaimExpense,
    ClaimInvoice,
    ClaimStatus,
    Invoice,
    InvoiceLineItem,
)
from app.models.travel_booking import TravelTrip
from app.models.travel_request import TravelRequest
from app.schemas.finance_reporting import FinanceFilterParams, ReportScheduleIn
from app.services.audit_service import log_event
from app.services.notification_service import send_email_async

logger = logging.getLogger(__name__)


def _date_bounds(from_date: date | None, to_date: date | None) -> tuple[datetime | None, datetime | None]:
    start = datetime.combine(from_date, datetime.min.time()) if from_date else None
    end = datetime.combine(to_date, datetime.max.time()) if to_date else None
    return start, end


def _zero_decimal() -> Decimal:
    return Decimal("0.00")


async def get_gst_summary(filters: FinanceFilterParams, db: AsyncSession) -> dict:
    employee_level = await _resolve_employee_level(filters.employee_level or filters.impact_level, db)
    start, end = _date_bounds(filters.from_date, filters.to_date)
    conditions = [
        ClaimDraft.status.in_([ClaimStatus.READY_FOR_PAYMENT.value, ClaimStatus.PAID.value])
    ]
    if start:
        conditions.append(ClaimDraft.created_at >= start)
    if end:
        conditions.append(ClaimDraft.created_at <= end)
    if filters.department:
        conditions.append(Employee.department == filters.department)
    if filters.office_location:
        conditions.append(Employee.office_location == filters.office_location)
    if employee_level:
        conditions.append(ImpactLevel.level_code == employee_level)
    if filters.expense_category:
        conditions.append(func.lower(func.coalesce(InvoiceLineItem.category_name, "")) == filters.expense_category.lower())

    query = (
        select(
            func.coalesce(func.sum(InvoiceLineItem.taxable_value), 0),
            func.coalesce(func.sum(InvoiceLineItem.cgst), 0),
            func.coalesce(func.sum(InvoiceLineItem.sgst), 0),
            func.coalesce(func.sum(InvoiceLineItem.igst), 0),
        )
        .select_from(ClaimDraft)
        .outerjoin(Employee, Employee.employee_id == ClaimDraft.employee_id)
        .outerjoin(ImpactLevel, ImpactLevel.id == Employee.impact_level_id)
        .outerjoin(ClaimInvoice, ClaimInvoice.claim_id == ClaimDraft.id)
        .outerjoin(Invoice, Invoice.id == ClaimInvoice.invoice_id)
        .outerjoin(InvoiceLineItem, InvoiceLineItem.invoice_id == Invoice.id)
    )
    if conditions:
        query = query.where(and_(*conditions))
    taxable_value, cgst, sgst, igst = (await db.execute(query)).one()

    eligible_query = (
        select(
            func.coalesce(
                func.sum(InvoiceLineItem.cgst + InvoiceLineItem.sgst + InvoiceLineItem.igst),
                0,
            )
        )
        .select_from(ClaimDraft)
        .join(Employee, Employee.employee_id == ClaimDraft.employee_id, isouter=True)
        .join(ImpactLevel, ImpactLevel.id == Employee.impact_level_id, isouter=True)
        .join(ClaimInvoice, ClaimInvoice.claim_id == ClaimDraft.id)
        .join(Invoice, Invoice.id == ClaimInvoice.invoice_id)
        .join(InvoiceLineItem, InvoiceLineItem.invoice_id == Invoice.id)
        .where(
            func.lower(func.coalesce(InvoiceLineItem.category_name, "")).notin_(
                ["commute", "personal items", "personal_item", "personal"]
            )
        )
    )
    if conditions:
        eligible_query = eligible_query.where(and_(*conditions))
    itc_eligible = (await db.execute(eligible_query)).scalar_one_or_none() or 0

    cgst_d = Decimal(str(cgst or 0))
    sgst_d = Decimal(str(sgst or 0))
    igst_d = Decimal(str(igst or 0))
    return {
        "taxable_value": Decimal(str(taxable_value or 0)),
        "cgst": cgst_d,
        "sgst": sgst_d,
        "igst": igst_d,
        "total_tax": cgst_d + sgst_d + igst_d,
        "itc_eligible_amount": Decimal(str(itc_eligible or 0)),
    }


async def get_spend_by_category(filters: FinanceFilterParams, db: AsyncSession) -> list[dict]:
    """What money is actually being spent on (Hotel, Software, Local Conveyance, ...) — driven
    by InvoiceLineItem.category_name, which is now set from Gemini's content-based
    expense_category classification when available (see reimbursement_service.
    _persist_parsed_extraction), not just a filename guess. Same claim-status/date/department
    filter convention as get_gst_summary, so the two stay consistent when sliced the same way."""
    employee_level = await _resolve_employee_level(filters.employee_level or filters.impact_level, db)
    start, end = _date_bounds(filters.from_date, filters.to_date)
    conditions = [
        ClaimDraft.status.in_([ClaimStatus.READY_FOR_PAYMENT.value, ClaimStatus.PAID.value])
    ]
    if start:
        conditions.append(ClaimDraft.created_at >= start)
    if end:
        conditions.append(ClaimDraft.created_at <= end)
    if filters.department:
        conditions.append(Employee.department == filters.department)
    if filters.office_location:
        conditions.append(Employee.office_location == filters.office_location)
    if employee_level:
        conditions.append(ImpactLevel.level_code == employee_level)

    query = (
        select(
            func.coalesce(InvoiceLineItem.category_name, "Uncategorised"),
            func.coalesce(func.sum(InvoiceLineItem.total_amount), 0),
        )
        .select_from(ClaimDraft)
        .outerjoin(Employee, Employee.employee_id == ClaimDraft.employee_id)
        .outerjoin(ImpactLevel, ImpactLevel.id == Employee.impact_level_id)
        .outerjoin(ClaimInvoice, ClaimInvoice.claim_id == ClaimDraft.id)
        .outerjoin(Invoice, Invoice.id == ClaimInvoice.invoice_id)
        .outerjoin(InvoiceLineItem, InvoiceLineItem.invoice_id == Invoice.id)
        .where(InvoiceLineItem.id.is_not(None))
        .group_by(func.coalesce(InvoiceLineItem.category_name, "Uncategorised"))
        .order_by(func.sum(InvoiceLineItem.total_amount).desc())
    )
    if conditions:
        query = query.where(and_(*conditions))
    rows = (await db.execute(query)).all()
    return [{"category": name, "amount": Decimal(str(amount or 0))} for name, amount in rows]


async def post_ledger_entry_to_erp(
    claim_id: int, posted_by_user_id: int, erp_system: str | None, db: AsyncSession
) -> ERPLedgerEntry:
    claim = await db.get(ClaimDraft, claim_id)
    if claim is None:
        raise HTTPException(status_code=404, detail="Claim not found")
    if claim.status != ClaimStatus.PAID:
        raise HTTPException(status_code=409, detail="Only paid claims can be posted to ERP")
    if not claim.payment_utr or not claim.payment_recorded_at:
        raise HTTPException(status_code=422, detail="Claim payment reference is missing")

    existing = await db.execute(select(ERPLedgerEntry).where(ERPLedgerEntry.claim_id == claim_id))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="ERP ledger entry already exists for this claim")

    expense_rows = await db.execute(
        select(ClaimExpense.category_name, func.coalesce(func.sum(ClaimExpense.amount), 0))
        .where(ClaimExpense.claim_id == claim_id)
        .group_by(ClaimExpense.category_name)
    )
    breakdown = {str(name): str(amount) for name, amount in expense_rows.all()}
    employee = await db.get(Employee, claim.employee_id) if claim.employee_id else None

    gst = claim.compliance_report.get("gst_summary", {}) if claim.compliance_report else {}
    taxable_value = gst.get("taxable_value", gst.get("total_taxable_value", "0"))
    entry = ERPLedgerEntry(
        claim_id=claim_id,
        employee_id=claim.employee_id,
        cost_centre=employee.cost_centre if employee else None,
        expense_category_breakdown=breakdown,
        taxable_value=Decimal(str(taxable_value)),
        cgst=Decimal(str(gst.get("cgst", "0"))),
        sgst=Decimal(str(gst.get("sgst", "0"))),
        igst=Decimal(str(gst.get("igst", "0"))),
        payment_reference=claim.payment_utr,
        payment_date=claim.payment_recorded_at,
        erp_system=erp_system,
        erp_entry_id=f"{(erp_system or 'ERP').upper()}-{claim.id}-{uuid4().hex[:8]}",
        status=ERPPostStatus.POSTED,
        posted_by_user_id=posted_by_user_id,
    )
    db.add(entry)
    await log_event(
        entity_type="erp_ledger_entry",
        entity_id=str(claim_id),
        action="erp_posted",
        actor_id=posted_by_user_id,
        old=None,
        new={
            "erp_system": erp_system,
            "erp_entry_id": entry.erp_entry_id,
            "payment_reference": claim.payment_utr,
            "taxable_value": str(entry.taxable_value),
        },
        db=db,
    )
    await db.commit()
    await db.refresh(entry)
    return entry


async def list_audit_logs(
    *,
    claim_id: str | None,
    employee_id: str | None,
    action: str | None,
    actor: str | None,
    from_date: date | None,
    to_date: date | None,
    db: AsyncSession,
) -> list[AuditLog]:
    query = select(AuditLog)
    conditions = []
    if claim_id:
        conditions.append(AuditLog.entity_id == claim_id)
    if employee_id:
        conditions.append(AuditLog.entity_id == employee_id)
    if action:
        conditions.append(AuditLog.action == action)
    if actor:
        needle = actor.strip()
        if needle.isdigit():
            conditions.append(AuditLog.actor_id == int(needle))
        else:
            query = query.outerjoin(User, User.id == AuditLog.actor_id)
            conditions.append(
                func.lower(func.coalesce(User.full_name, User.email, "")).contains(needle.lower())
            )
    start, end = _date_bounds(from_date, to_date)
    if start:
        conditions.append(AuditLog.timestamp >= start)
    if end:
        conditions.append(AuditLog.timestamp <= end)
    if conditions:
        query = query.where(and_(*conditions))
    query = query.order_by(AuditLog.timestamp.desc(), AuditLog.id.desc()).limit(1000)
    return list((await db.execute(query)).scalars().all())


async def schedule_report(payload: ReportScheduleIn, user_id: int, db: AsyncSession) -> ScheduledReport:
    if payload.report_format.value != "CSV":
        raise HTTPException(status_code=422, detail="Only CSV report_format is currently supported")
    row = ScheduledReport(
        report_type=payload.report_type,
        report_format=payload.report_format,
        frequency=payload.frequency,
        recipients=payload.recipients,
        filters=payload.filters,
        created_by_user_id=user_id,
        # Due immediately so the first run happens on the next scheduler tick (see
        # run_scheduled_reports) rather than waiting a full cycle for the first email.
        next_run_at=datetime.utcnow(),
    )
    db.add(row)
    await db.flush()
    await log_event(
        entity_type="scheduled_report",
        entity_id=str(row.id),
        action="report_schedule_created",
        actor_id=user_id,
        old=None,
        new={
            "report_type": payload.report_type,
            "report_format": payload.report_format.value,
            "frequency": payload.frequency.value,
            "recipients": payload.recipients,
        },
        db=db,
    )
    await db.commit()
    await db.refresh(row)
    return row


async def list_scheduled_reports(db: AsyncSession) -> list[ScheduledReport]:
    result = await db.execute(select(ScheduledReport).order_by(ScheduledReport.created_at.desc()))
    return list(result.scalars().all())


def _rows_to_csv_bytes(rows: list[dict]) -> bytes:
    """Same shape as the CSV branch of the /reports/{type}/export endpoint, factored out so
    the scheduler can build an identical attachment without going through the HTTP layer."""
    output = io.StringIO()
    if rows:
        writer = csv.DictWriter(output, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    return output.getvalue().encode("utf-8")


def _advance_next_run(frequency: ScheduleFrequency, from_dt: datetime) -> datetime:
    if frequency == ScheduleFrequency.DAILY:
        return from_dt + timedelta(days=1)
    if frequency == ScheduleFrequency.WEEKLY:
        return from_dt + timedelta(days=7)
    # MONTHLY: advance one calendar month, clamping the day to that month's length (e.g. Jan
    # 31 -> Feb 28/29) rather than overflowing into the following month.
    month = from_dt.month + 1
    year = from_dt.year + (month - 1) // 12
    month = ((month - 1) % 12) + 1
    day = min(from_dt.day, calendar.monthrange(year, month)[1])
    return from_dt.replace(year=year, month=month, day=day)


async def run_scheduled_reports(db: AsyncSession) -> int:
    """Finds every active schedule whose next_run_at is due, generates that report as CSV,
    emails it to each recipient, and reschedules it for its next occurrence. Called
    periodically by the background loop started in main.py's _run_monitors."""
    now = datetime.utcnow()
    due = (
        await db.execute(
            select(ScheduledReport).where(
                ScheduledReport.is_active.is_(True),
                or_(ScheduledReport.next_run_at.is_(None), ScheduledReport.next_run_at <= now),
            )
        )
    ).scalars().all()
    for schedule in due:
        try:
            # Filters are stored as raw JSON from the "Run Report" panel's state, which may
            # include empty strings for unset date fields — FinanceFilterParams' date fields
            # reject "" (only a real date or None), so strip blanks before validating.
            clean_filters = {k: v for k, v in (schedule.filters or {}).items() if v not in (None, "")}
            filters = FinanceFilterParams(**clean_filters)
            report = await generate_report(schedule.report_type, filters, db)
            csv_bytes = _rows_to_csv_bytes(report.get("rows") or [])
            subject = f"Scheduled report: {schedule.report_type} ({schedule.frequency.value.title()})"
            body = f"Attached is your {schedule.frequency.value.lower()} '{schedule.report_type}' report from Travora."
            for recipient in schedule.recipients:
                await send_email_async(
                    recipient,
                    subject,
                    body,
                    attachments=[{"filename": f"{schedule.report_type}.csv", "content": csv_bytes}],
                )
            schedule.last_run_at = now
        except Exception:
            logger.exception("Failed to run scheduled report %s", schedule.id)
        finally:
            # Reschedule even on failure so one bad run doesn't wedge the schedule forever.
            schedule.next_run_at = _advance_next_run(schedule.frequency, now)
    await db.commit()
    return len(due)


async def list_erp_ledger_entries(
    *,
    from_date: date | None,
    to_date: date | None,
    employee: str | None,
    cost_centre: str | None,
    status_value: str | None,
    db: AsyncSession,
) -> list[ERPLedgerEntry]:
    query = select(ERPLedgerEntry)
    start, end = _date_bounds(from_date, to_date)
    if start:
        query = query.where(ERPLedgerEntry.payment_date >= start)
    if end:
        query = query.where(ERPLedgerEntry.payment_date <= end)
    if employee:
        query = query.where(func.lower(func.coalesce(ERPLedgerEntry.employee_id, "")).contains(employee.lower()))
    if cost_centre:
        query = query.where(func.lower(func.coalesce(ERPLedgerEntry.cost_centre, "")).contains(cost_centre.lower()))
    if status_value:
        normalized = status_value.upper().strip()
        if normalized not in {item.value for item in ERPPostStatus}:
            raise HTTPException(status_code=422, detail="Invalid ERP status filter")
        query = query.where(ERPLedgerEntry.status == ERPPostStatus(normalized))
    query = query.order_by(ERPLedgerEntry.payment_date.desc(), ERPLedgerEntry.id.desc())
    return list((await db.execute(query)).scalars().all())


async def generate_report(report_type: str, filters: FinanceFilterParams, db: AsyncSession) -> dict:
    employee_level = await _resolve_employee_level(filters.employee_level, db)
    start, end = _date_bounds(filters.from_date, filters.to_date)
    if report_type == "claim-aging":
        q = (
            select(ClaimDraft.status, func.count(ClaimDraft.id))
            .select_from(ClaimDraft)
            .outerjoin(Employee, Employee.employee_id == ClaimDraft.employee_id)
            .outerjoin(ImpactLevel, ImpactLevel.id == Employee.impact_level_id)
            .where(ClaimDraft.is_exception_shell.is_(False))
            .group_by(ClaimDraft.status)
        )
        if start:
            q = q.where(ClaimDraft.created_at >= start)
        if end:
            q = q.where(ClaimDraft.created_at <= end)
        if employee_level:
            q = q.where(ImpactLevel.level_code == employee_level)
        rows = (await db.execute(q)).all()
        return {"report_type": report_type, "rows": [{"stage": s.value, "count": c} for s, c in rows]}

    if report_type == "approval-tat":
        q = select(
            ClaimApprovalStage.stage_label,
            ClaimApprovalStage.sla_deadline_at,
            ClaimApprovalStage.decided_at,
        ).select_from(ClaimApprovalStage).join(
            ClaimDraft, ClaimDraft.id == ClaimApprovalStage.claim_id
        ).outerjoin(
            Employee, Employee.employee_id == ClaimDraft.employee_id
        ).outerjoin(
            ImpactLevel, ImpactLevel.id == Employee.impact_level_id
        ).where(
            ClaimApprovalStage.decided_at.is_not(None),
            ClaimApprovalStage.sla_deadline_at.is_not(None),
            ClaimDraft.is_exception_shell.is_(False),
        )
        if employee_level:
            q = q.where(ImpactLevel.level_code == employee_level)
        rows = (await db.execute(q)).all()
        by_stage: dict[str, list[int]] = {}
        for stage, sla_deadline_at, decided_at in rows:
            if sla_deadline_at is None or decided_at is None:
                continue
            by_stage.setdefault(stage, []).append(int((decided_at - sla_deadline_at).total_seconds()))
        return {
            "report_type": report_type,
            "rows": [
                {
                    "stage": stage,
                    "average_delta_seconds": int(sum(values) / len(values)) if values else 0,
                }
                for stage, values in by_stage.items()
            ],
        }

    if report_type == "travel-spend-summary":
        q = (
            select(TravelTrip.mode, func.coalesce(func.sum(TravelTrip.amount), 0))
            .select_from(TravelTrip)
            .outerjoin(User, User.id == TravelTrip.employee_user_id)
            .outerjoin(Employee, Employee.employee_id == User.employee_id)
            .outerjoin(ImpactLevel, ImpactLevel.id == Employee.impact_level_id)
            .group_by(TravelTrip.mode)
            .order_by(func.sum(TravelTrip.amount).desc())
        )
        if employee_level:
            q = q.where(ImpactLevel.level_code == employee_level)
        rows = (await db.execute(q)).all()
        return {"report_type": report_type, "rows": [{"travel_mode": d.value, "spend": str(v)} for d, v in rows]}

    if report_type == "travel-requests-summary":
        q = (
            select(TravelRequest.status, func.count(TravelRequest.id))
            .select_from(TravelRequest)
            .outerjoin(User, User.id == TravelRequest.employee_user_id)
            .outerjoin(Employee, Employee.employee_id == User.employee_id)
            .outerjoin(ImpactLevel, ImpactLevel.id == Employee.impact_level_id)
            .group_by(TravelRequest.status)
        )
        if start:
            q = q.where(TravelRequest.requested_at >= start)
        if end:
            q = q.where(TravelRequest.requested_at <= end)
        if employee_level:
            q = q.where(ImpactLevel.level_code == employee_level)
        rows = (await db.execute(q)).all()
        return {
            "report_type": report_type,
            "rows": [{"status": str(status), "count": int(count)} for status, count in rows],
        }

    raise HTTPException(status_code=404, detail="Unsupported report_type")


def generate_excel_report(report_type: str, data: list[dict]) -> bytes:
    output = io.BytesIO()
    workbook = xlsxwriter.Workbook(output)
    worksheet = workbook.add_worksheet(report_type[:31])
    
    if not data:
        workbook.close()
        return output.getvalue()
        
    header_fmt = workbook.add_format({"bold": True, "bg_color": "#F1F5F9", "border": 1})
    headers = list(data[0].keys())
    
    for col, h in enumerate(headers):
        worksheet.write(0, col, h.replace("_", " ").title(), header_fmt)
        worksheet.set_column(col, col, 20)
        
    for row_idx, row_data in enumerate(data, start=1):
        for col_idx, key in enumerate(headers):
            worksheet.write(row_idx, col_idx, str(row_data.get(key, "")))
            
    workbook.close()
    return output.getvalue()


def generate_pdf_report(report_type: str, data: list[dict]) -> bytes:
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("helvetica", "B", 16)
    pdf.cell(0, 10, f"SIL - {report_type.replace('-', ' ').title()}", ln=True, align="C")
    pdf.set_font("helvetica", "", 10)
    pdf.cell(0, 10, f"Generated on: {datetime.now().strftime('%Y-%m-%d %H:%M')}", ln=True, align="C")
    pdf.ln(10)
    
    if not data:
        pdf.cell(0, 10, "No data available for this criteria.", ln=True)
        return pdf.output()
        
    headers = list(data[0].keys())
    pdf.set_font("helvetica", "B", 10)
    col_width = (pdf.w - 20) / len(headers)
    
    for h in headers:
        pdf.cell(col_width, 10, h.replace("_", " ").title()[:15], border=1)
    pdf.ln()
    
    pdf.set_font("helvetica", "", 9)
    for row in data:
        for key in headers:
            pdf.cell(col_width, 10, str(row.get(key, ""))[:20], border=1)
        pdf.ln()
        
    return pdf.output()


async def get_policy_violations(
    *,
    from_date: date | None,
    to_date: date | None,
    department: str | None,
    db: AsyncSession,
) -> dict:
    start, end = _date_bounds(from_date, to_date)
    query = (
        select(
            ClaimDraft.id,
            ClaimDraft.employee_id,
            Employee.department,
            ClaimExpense.category_name,
            ClaimExpense.amount,
            ClaimExpense.cap_amount,
        )
        .select_from(ClaimExpense)
        .join(ClaimDraft, ClaimDraft.id == ClaimExpense.claim_id)
        .outerjoin(Employee, Employee.employee_id == ClaimDraft.employee_id)
        .where(
            ClaimExpense.cap_amount.is_not(None),
            ClaimExpense.amount > ClaimExpense.cap_amount,
        )
    )
    if start:
        query = query.where(ClaimDraft.created_at >= start)
    if end:
        query = query.where(ClaimDraft.created_at <= end)
    if department:
        query = query.where(func.lower(func.coalesce(Employee.department, "")) == department.lower())
    query = query.order_by(ClaimDraft.id.desc())

    rows = (await db.execute(query)).all()
    dept_set: set[str] = set()
    category_set: set[str] = set()
    matrix: dict[str, dict[str, int]] = {}
    violations: list[dict] = []

    for claim_id, employee_id, dept, category, claimed, cap in rows:
        dept_key = dept or "Unknown"
        cat_key = category or "Uncategorised"
        claimed_d = Decimal(str(claimed or 0))
        cap_d = Decimal(str(cap or 0))
        excess_d = max(claimed_d - cap_d, Decimal("0.00"))

        dept_set.add(dept_key)
        category_set.add(cat_key)
        matrix.setdefault(dept_key, {})
        matrix[dept_key][cat_key] = matrix[dept_key].get(cat_key, 0) + 1
        violations.append(
            {
                "claim_id": int(claim_id),
                "employee_id": employee_id,
                "department": dept,
                "category": cat_key,
                "claimed": claimed_d,
                "cap": cap_d,
                "excess": excess_d,
            }
        )

    departments = sorted(dept_set)
    categories = sorted(category_set)
    dense_matrix = {
        dept_name: {category_name: matrix.get(dept_name, {}).get(category_name, 0) for category_name in categories}
        for dept_name in departments
    }
    return {
        "departments": departments,
        "categories": categories,
        "matrix": dense_matrix,
        "violations": violations,
    }


async def list_exception_requests_log(
    *,
    status_value: str | None,
    exception_type: str | None,
    from_date: date | None,
    to_date: date | None,
    db: AsyncSession,
    current_user_id: int | None = None,
) -> list[dict]:
    current_user = await db.get(User, current_user_id) if current_user_id else None
    query = (
        select(
            ExceptionRequest,
            ClaimDraft.claim_reference,
            User.full_name,
            User.employee_id,
            User.email,
            User.id,
            User.email,
            User.full_name,
        )
        .outerjoin(ClaimDraft, ClaimDraft.id == ExceptionRequest.claim_id)
        .outerjoin(User, User.id == ExceptionRequest.requested_by_user_id)
    )
    start, end = _date_bounds(from_date, to_date)
    if start:
        query = query.where(ExceptionRequest.created_at >= start)
    if end:
        query = query.where(ExceptionRequest.created_at <= end)
    if status_value:
        query = query.where(func.lower(ExceptionRequest.status) == status_value.lower())
    if exception_type:
        query = query.where(func.lower(ExceptionRequest.exception_type).contains(exception_type.lower()))
    query = query.order_by(ExceptionRequest.created_at.desc())
    result = (await db.execute(query)).all()

    exc_ids = [row[0].id for row in result]
    approvals_map: dict[int, list[ExceptionApproval]] = {}
    if exc_ids:
        appr_rows = (
            await db.execute(
                select(ExceptionApproval).where(ExceptionApproval.exception_request_id.in_(exc_ids))
            )
        ).scalars().all()
        for appr in appr_rows:
            approvals_map.setdefault(appr.exception_request_id, []).append(appr)

    decided_by_ids = {row[0].decided_by_user_id for row in result if row[0].decided_by_user_id is not None}
    decided_users: dict[int, str] = {}
    if decided_by_ids:
        users = (await db.execute(select(User).where(User.id.in_(decided_by_ids)))).scalars().all()
        decided_users = {user.id: (user.full_name or user.email) for user in users}

    response: list[dict] = []
    for exc, claim_ref, full_name, employee_id, email, *_ in result:
        approvals = approvals_map.get(exc.id, [])
        if status_value and status_value.upper() == "PENDING" and current_user:
            from app.services.workflow_service import _can_user_act_on_exception
            if not await _can_user_act_on_exception(current_user, exc, approvals, db):
                continue
        # Every reference in this log follows the same "PREFIX-0000" shape (matching the
        # persisted CLM-YYYY-NNNN claim_reference) instead of mixing a bare id, a padded
        # code, and a spelled-out "Travel Request #N" string across the three id types.
        if claim_ref:
            resolved_ref = claim_ref
        elif exc.claim_id:
            resolved_ref = f"CLM-{exc.claim_id:04d}"
        elif exc.travel_request_id:
            resolved_ref = f"TR-{exc.travel_request_id:04d}"
        else:
            resolved_ref = None

        response.append(
            {
                "exception_id": exc.id,
                "exception_ref": f"EXC-{exc.id:04d}",
                "claim_id": exc.claim_id,
                "claim_ref": resolved_ref,
                "employee": full_name or email,
                "employee_id": employee_id,
                "exception_type": exc.exception_type,
                "exception_types": exc.exception_types or [exc.exception_type],
                "status": exc.status,
                "requested_on": exc.created_at,
                "decided_by": decided_users.get(exc.decided_by_user_id) if exc.decided_by_user_id else None,
                "description": exc.description,
                "required_approvers": [a.required_role for a in approvals],
                "decisions": [
                    {
                        "required_role": a.required_role,
                        "status": a.status,
                        "acted_by_user_id": a.acted_by_user_id,
                        "acted_at": a.acted_at,
                        "comment": a.comment,
                    }
                    for a in approvals
                ],
            }
        )
    return response


async def _resolve_employee_level(employee_level: str | None, db: AsyncSession) -> str | None:
    if employee_level is None:
        return None
    normalized = employee_level.strip()
    if not normalized:
        return None
    row = (
        await db.execute(
            select(ImpactLevel.level_code).where(
                func.lower(ImpactLevel.level_code) == normalized.lower()
            )
        )
    ).scalar_one_or_none()
    if row is None:
        row = (
            await db.execute(
                select(ImpactLevel.level_code).where(
                    func.lower(ImpactLevel.level_name) == normalized.lower()
                )
            )
        ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=422, detail="Invalid employee_level filter value")
    return str(row)
