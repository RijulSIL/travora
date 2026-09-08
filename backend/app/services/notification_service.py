import asyncio
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.auth import User
from app.models.claim_workflow import Notification


def send_email_sync(to_email: str, subject: str, body_text: str, body_html: str | None = None) -> None:
    """
    Synchronous SMTP dispatch block.
    If smtp_host is unset/empty or matches placeholder, functions in SIMULATOR mode.
    """
    host = settings.smtp_host
    if not host or host == "smtp.example.com" or "example.com" in host.lower():
        print(f"\n==================================================")
        print(f"[SMTP SIMULATOR] OUTGOING EMAIL")
        print(f"To:      {to_email}")
        print(f"Subject: {subject}")
        print(f"Body:\n{body_text}")
        print(f"==================================================\n")
        return

    # Real SMTP send
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = settings.smtp_from_email
    msg["To"] = to_email

    # Plaintext fallback
    msg.attach(MIMEText(body_text, "plain"))
    
    # HTML body
    if body_html:
        msg.attach(MIMEText(body_html, "html"))
    else:
        # Default simple template if none provided
        simple_html = f"""
        <html>
        <body style="font-family: Arial, sans-serif; color: #333333; line-height: 1.6;">
            <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
                <h2 style="color: #1a365d; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px;">Travora Notification</h2>
                <p>{body_text}</p>
                <div style="margin-top: 30px; padding-top: 15px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #718096;">
                    This is an automated system email. Please do not reply to this address.
                </div>
            </div>
        </body>
        </html>
        """
        msg.attach(MIMEText(simple_html, "html"))

    try:
        # Connect to SMTP
        port = settings.smtp_port
        use_ssl = (port == 465)
        
        if use_ssl:
            server_class = smtplib.SMTP_SSL
        else:
            server_class = smtplib.SMTP

        with server_class(host, port, timeout=10) as server:
            if not use_ssl and port != 1025:
                server.ehlo()
                try:
                    server.starttls()
                    server.ehlo()
                except Exception as te:
                    print(f"[SMTP WARNING] STARTTLS failed or unsupported: {te}")

            user = settings.smtp_user
            password = settings.smtp_password
            if user and password and "dummy" not in user:
                server.login(user, password)

            server.sendmail(settings.smtp_from_email, to_email, msg.as_string())
            print(f"[SMTP SUCCESS] Email successfully dispatched to {to_email}")
    except Exception as e:
        print(f"[SMTP ERROR] Failed to send email to {to_email} via {host}:{port}: {e}")


async def send_email_async(to_email: str, subject: str, body_text: str, body_html: str | None = None) -> None:
    """
    Dispatches the email asynchronously via a separate thread worker.
    """
    await asyncio.to_thread(send_email_sync, to_email, subject, body_text, body_html)


async def create_notification(
    user_id: int,
    title: str,
    body: str | None,
    link: str | None,
    category: str,
    db: AsyncSession,
) -> Notification:
    row = Notification(
        user_id=user_id,
        title=title.strip(),
        body=body.strip() if body else None,
        link=link.strip() if link else None,
        category=category,
        is_read=False,
    )
    db.add(row)
    await db.flush()

    # Email dispatch logic
    try:
        user_result = await db.execute(select(User).where(User.id == user_id))
        user = user_result.scalar_one_or_none()
        if user and user.email:
            email_body = body if body else title
            
            # Resolve Theme, Colors, and Badges based on keywords in title
            theme_color = "#3182ce"  # Default Blue
            status_label = "Info"
            title_lower = title.lower()
            
            if "approved" in title_lower or "settled" in title_lower:
                theme_color = "#2f855a"  # Green
                status_label = "Approved"
            elif "rejected" in title_lower:
                theme_color = "#c53030"  # Red
                status_label = "Rejected"
            elif "sent back" in title_lower or "clarification" in title_lower:
                theme_color = "#dd6b20"  # Orange
                status_label = "Revision Required"
            elif "pending" in title_lower or "approval" in title_lower:
                theme_color = "#2b6cb0"  # Blue
                status_label = "Pending Action"
            elif "breach" in title_lower or "critical" in title_lower:
                theme_color = "#e53e3e"  # Dark Red
                status_label = "Critical Escalation"
            elif "advance" in title_lower or "reminder" in title_lower:
                theme_color = "#d69e2e"  # Yellow-Gold
                status_label = "Action Required"

            # Parse out Reason / Remarks callout from the body if present
            reason_text = None
            main_message = email_body
            for sep in ["Reason:", "Remarks:", "Reason :", "Remarks :"]:
                if sep in email_body:
                    parts = email_body.split(sep, 1)
                    main_message = parts[0].strip()
                    reason_text = parts[1].strip()
                    break

            # Parse out Route or reference from main message
            route_or_target = "N/A"
            if "->" in main_message:
                import re
                route_match = re.search(r'([A-Za-z0-9\s]+)\s*->\s*([A-Za-z0-9\s]+)', main_message)
                if route_match:
                    route_or_target = f"{route_match.group(1).strip()} ➔ {route_match.group(2).strip()}"
            
            import re
            ref_match = re.search(r'(CLM-\d+|CLM\d+|TR-\d+|TR\d+)', email_body)
            if ref_match:
                if route_or_target != "N/A":
                    route_or_target = f"{ref_match.group(1)} ({route_or_target})"
                else:
                    route_or_target = ref_match.group(1)

            category_display = category.replace("_", " ").title()
            
            # Construct a beautifully organized grid
            grid_html = f"""
            <tr style="border-bottom: 1px solid #edf2f7;">
                <td style="padding: 12px 16px; font-weight: bold; color: #4a5568; width: 140px; background-color: #f8fafc; font-size: 14px;">Category</td>
                <td style="padding: 12px 16px; color: #2d3748; font-size: 14px;">{category_display}</td>
            </tr>
            """
            
            if route_or_target != "N/A":
                grid_html += f"""
                <tr style="border-bottom: 1px solid #edf2f7;">
                    <td style="padding: 12px 16px; font-weight: bold; color: #4a5568; background-color: #f8fafc; font-size: 14px;">Target / Route</td>
                    <td style="padding: 12px 16px; color: #2d3748; font-weight: 600; font-size: 14px;">{route_or_target}</td>
                </tr>
                """
                
            grid_html += f"""
            <tr style="border-bottom: 1px solid #edf2f7;">
                <td style="padding: 12px 16px; font-weight: bold; color: #4a5568; background-color: #f8fafc; font-size: 14px;">Status</td>
                <td style="padding: 12px 16px; font-size: 14px;">
                    <span style="background-color: {theme_color}1a; color: {theme_color}; padding: 4px 12px; border-radius: 9999px; font-weight: bold; font-size: 12px; border: 1px solid {theme_color}33; display: inline-block;">
                        {status_label}
                    </span>
                </td>
            </tr>
            """

            # Auditor Remarks Callout Alert block
            reason_box_html = ""
            if reason_text:
                reason_box_html = f"""
                <div style="margin-top: 25px; padding: 18px 24px; background-color: {theme_color}0d; border-left: 4px solid {theme_color}; border-radius: 4px;">
                    <strong style="color: {theme_color}; font-size: 14px; display: block; margin-bottom: 6px;">Auditor/Approver Remarks:</strong>
                    <span style="color: #2d3748; font-size: 14px; font-style: italic;">"{reason_text}"</span>
                </div>
                """

            # Call-to-action Button
            link_html = ""
            if link:
                frontend_url = f"http://localhost:3000{link}"
                link_html = f"""
                <div style="margin-top: 30px; text-align: center;">
                    <a href="{frontend_url}" style="background-color: {theme_color}; color: #ffffff; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; font-size: 15px; box-shadow: 0 4px 6px -1px {theme_color}40; transition: all 0.2s;">
                        Open Action Portal &rarr;
                    </a>
                </div>
                """

            html_content = f"""
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <title>{title}</title>
            </head>
            <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #2d3748; line-height: 1.6; background-color: #f7fafc; margin: 0; padding: 40px 20px;">
                <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.05), 0 4px 6px -2px rgba(0, 0, 0, 0.02); border: 1px solid #e2e8f0; overflow: hidden;">
                    
                    <!-- Top Corporate Bar -->
                    <div style="background: linear-gradient(135deg, #1a365d 0%, #2a4365 100%); padding: 30px 40px; text-align: left; border-bottom: 4px solid {theme_color};">
                        <div style="font-size: 11px; font-weight: 800; color: #90cdf4; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 4px;">SIMON INDIA LIMITED</div>
                        <div style="font-size: 20px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px;">Travora</div>
                    </div>
                    
                    <!-- Main Body Card -->
                    <div style="padding: 40px;">
                        <h2 style="color: #1a202c; font-size: 20px; font-weight: 700; margin-top: 0; margin-bottom: 12px;">{title}</h2>
                        <p style="font-size: 15px; color: #4a5568; margin-top: 0; margin-bottom: 25px; line-height: 1.5;">{main_message}</p>
                        
                        <!-- Grid Matrix Table -->
                        <table style="width: 100%; border-collapse: collapse; border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden;">
                            <tbody>
                                {grid_html}
                            </tbody>
                        </table>
                        
                        <!-- Dynamic Remarks Callout block -->
                        {reason_box_html}
                        
                        <!-- Portal CTA Button -->
                        {link_html}
                    </div>
                    
                    <!-- Corporate Footer -->
                    <div style="background-color: #f8fafc; padding: 24px 40px; border-top: 1px solid #edf2f7; font-size: 12px; color: #718096; text-align: center;">
                        <p style="margin: 0; font-weight: 600; color: #4a5568;">Simon India Ltd. (SIL) Travora System</p>
                        <p style="margin: 4px 0 0 0; color: #a0aec0;">This is an automated transactional message. Replies to this email address are not monitored.</p>
                        <p style="margin: 12px 0 0 0; font-size: 11px;"><a href="mailto:{settings.smtp_from_email}" style="color: #3182ce; text-decoration: none;">Support Contact: {settings.smtp_from_email}</a></p>
                    </div>
                </div>
            </body>
            </html>
            """
            
            # Fire and forget asynchronous call
            asyncio.create_task(send_email_async(
                to_email=user.email,
                subject=f"[Travora] {title}",
                body_text=email_body,
                body_html=html_content
            ))
    except Exception as email_err:
        print(f"[SMTP DISPATCH WARNING] Could not trigger email notification: {email_err}")

    return row


async def mark_read(notification_id: int, user_id: int, db: AsyncSession) -> Notification:
    row = await db.get(Notification, notification_id)
    if row is None or row.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    row.is_read = True
    await db.commit()
    await db.refresh(row)
    return row


async def mark_all_read(user_id: int, db: AsyncSession) -> int:
    result = await db.execute(
        select(Notification).where(Notification.user_id == user_id, Notification.is_read.is_(False))
    )
    rows = list(result.scalars().all())
    for row in rows:
        row.is_read = True
    await db.commit()
    return len(rows)


async def list_notifications(user_id: int, db: AsyncSession, limit: int = 20) -> list[Notification]:
    safe_limit = max(1, min(limit, 100))
    result = await db.execute(
        select(Notification)
        .where(Notification.user_id == user_id)
        .order_by(Notification.created_at.desc(), Notification.sqlid.desc())
        .limit(safe_limit)
    )
    return list(result.scalars().all())


async def unread_count(user_id: int, db: AsyncSession) -> int:
    result = await db.execute(
        select(func.count(Notification.sqlid)).where(Notification.user_id == user_id, Notification.is_read.is_(False))
    )
    return int(result.scalar_one() or 0)
