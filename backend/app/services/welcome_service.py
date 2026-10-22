# ruff: noqa: E501 — the email's inline-styled HTML (email clients ignore stylesheets) runs long.
"""The welcome email for people added to Travora (Add user, CSV import, Resend in User
management). Everyone added starts with TEMPORARY_PASSWORD and must set their own at their first
sign-in (users.must_change_password).

The subject and message come from the editable "user_welcome" notification template; the details
(sign-in email, temporary password, role, department, manager) and the Sign in button are always
added below the message, so nobody gets a welcome email without their sign-in details."""

import asyncio
import html
import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.timezone import now_ist
from app.models.auth import User
from app.models.claim_workflow import NotificationTemplate
from app.models.employee import Employee
from app.models.expense_category import CompanyProfile
from app.services.notification_service import send_email_async

TEMPORARY_PASSWORD = "Welcome@123"
TEMPLATE_KEY = "user_welcome"
# Same names the app shows (frontend formatters.js).
_ROLE_NAMES = {
    "EMPLOYEE": "Employee",
    "REPORTING_MANAGER": "Manager",
    "HRBP_HR": "HRBP / HR",
    "PAYROLL": "Payroll",
    "FINANCE": "Finance",
    "IT_ADMIN": "IT Admin",
    "CEO": "CEO",
    "GROUP_HEAD_HR": "Group Head HR",
    "RECRUITER": "Recruiter",
}

_DEFAULT_SUBJECT = "Welcome to Travora, {{first_name}}"
_DEFAULT_BODY = (
    "Hi {{first_name}},\n\nYour Travora account is ready.\n\nYour first sign-in\n"
    "1. Sign in with your email and the temporary password below.\n2. Enter the code we email you.\n"
    "3. Set your own password. The temporary one stops working after that."
)


def _render(template: str, values: dict[str, str]) -> str:
    """Fills {{placeholders}}; unknown ones are left as they are."""
    return re.sub(r"\{\{\s*(\w+)\s*\}\}", lambda m: values.get(m.group(1), m.group(0)), template)


async def _values(user: User, db: AsyncSession) -> dict[str, str]:
    employee = await db.get(Employee, user.employee_id) if user.employee_id else None
    manager_name = ""
    if employee and employee.reporting_manager_id:
        manager = (await db.execute(select(User).where(User.employee_id == employee.reporting_manager_id))).scalars().first()
        manager_employee = await db.get(Employee, employee.reporting_manager_id)
        manager_name = (manager.full_name if manager else None) or (manager_employee.full_name if manager_employee else "")
    profile = (await db.execute(select(CompanyProfile))).scalar_one_or_none()
    name = user.full_name or (employee.full_name if employee else None) or user.email
    return {
        "name": name,
        "first_name": name.split()[0] if name else "",
        "email": user.email,
        "temporary_password": TEMPORARY_PASSWORD,
        "role": _ROLE_NAMES.get(user.role.value, user.role.value.replace("_", " ").title())
        + (" · Manager" if user.is_manager and user.role.value not in ("CEO", "REPORTING_MANAGER") else ""),
        "department": (employee.department if employee else None) or "",
        "manager": manager_name or "",
        "company_name": (profile.company_name if profile else "") or "",
        "login_link": f"{settings.app_url.rstrip('/')}/login",
    }


def _html(message: str, values: dict[str, str]) -> str:
    e = {k: html.escape(v) for k, v in values.items()}
    paragraphs = "".join(
        f'<p style="margin:0 0 14px;">{html.escape(block).replace(chr(10), "<br>")}</p>'
        for block in re.split(r"\n\s*\n", message.strip())
        if block.strip()
    )
    rows = [
        ("Sign-in email", e["email"]),
        (
            "Temporary password",
            '<span style="font-family:Courier New,monospace;font-weight:bold;font-size:15px;'
            f'background:#fef9c3;padding:2px 6px;border-radius:4px;">{e["temporary_password"]}</span>',
        ),
        ("Role", e["role"]),
    ]
    if e["department"]:
        rows.append(("Department", e["department"]))
    if e["manager"]:
        rows.append(("Reports to", e["manager"]))
    table = "".join(
        f'<tr><td style="padding:10px 14px;border-top:1px solid #edf2f7;background:#f8fafc;font-weight:bold;'
        f'color:#4a5568;width:150px;">{label}</td><td style="padding:10px 14px;border-top:1px solid #edf2f7;">'
        f"{value}</td></tr>"
        for label, value in rows
    )
    company = f"{e['company_name']} · Travora" if e["company_name"] else "Travora"
    return f"""<!DOCTYPE html><html><body style="margin:0;padding:24px 12px;background:#eef2f1;font-family:Arial,Helvetica,sans-serif;color:#2d3748;">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #dfe7e4;">
  <div style="background:#116149;color:#ffffff;padding:22px 26px;">
    <div style="font-size:12px;opacity:.8;letter-spacing:.04em;text-transform:uppercase;">{company}</div>
    <div style="margin-top:4px;font-size:21px;font-weight:bold;">Welcome aboard, {e["first_name"]}</div>
  </div>
  <div style="padding:22px 26px;font-size:14px;line-height:1.6;">
    {paragraphs}
    <table style="width:100%;border-collapse:collapse;border:1px solid #edf2f7;margin:6px 0 18px;font-size:14px;">{table}</table>
    <div style="text-align:center;margin:22px 0 8px;">
      <a href="{e["login_link"]}" style="background:#116149;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:bold;display:inline-block;">Sign in to Travora</a>
    </div>
    <div style="font-size:12px;color:#718096;text-align:center;word-break:break-all;">{e["login_link"]}</div>
  </div>
  <div style="border-top:1px solid #edf2f7;padding:14px 26px;font-size:12px;color:#718096;background:#fafbfb;">This is an automatic message from Travora — please don't reply to it.</div>
</div></body></html>"""


async def send_welcome_email(user: User, db: AsyncSession) -> bool:
    """Sends the welcome email and records when. Returns whether it went out. Doesn't commit."""
    template = (
        await db.execute(select(NotificationTemplate).where(NotificationTemplate.template_key == TEMPLATE_KEY))
    ).scalar_one_or_none()
    values = await _values(user, db)
    subject = _render((template.subject if template and template.subject else _DEFAULT_SUBJECT), values)
    message = _render((template.body_text if template and template.body_text else _DEFAULT_BODY), values)
    details = [f"Sign-in email: {values['email']}", f"Temporary password: {values['temporary_password']}", f"Role: {values['role']}"]
    if values["department"]:
        details.append(f"Department: {values['department']}")
    if values["manager"]:
        details.append(f"Reports to: {values['manager']}")
    text = f"{message}\n\n" + "\n".join(details) + f"\n\nSign in: {values['login_link']}"
    try:
        sent = await send_email_async(user.email, subject, text, _html(message, values))
    except Exception:  # noqa: BLE001 — a failed email must never undo adding the person
        sent = False
    if sent:
        user.welcome_email_sent_at = now_ist()
    return bool(sent)


async def send_welcome_emails_later(user_ids: list[int]) -> None:
    """Background job after a CSV import: emails each person one at a time, with a short pause
    (settings.email_send_delay_seconds) after each — mail servers like Gmail cut the connection
    when a burst of emails arrives at once. Each send uses its own database session (the
    request's has closed by now); one failing never stops the rest."""
    from app.core.database import AsyncSessionLocal

    for index, user_id in enumerate(user_ids):
        try:
            async with AsyncSessionLocal() as db:
                user = await db.get(User, user_id)
                if user is None or not user.is_active or not user.must_change_password:
                    continue
                if await send_welcome_email(user, db):
                    await db.commit()
        except Exception:  # noqa: BLE001 — that person's profile shows the email wasn't sent
            pass
        if index < len(user_ids) - 1:
            await asyncio.sleep(settings.email_send_delay_seconds)
