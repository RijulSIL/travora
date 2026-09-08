import hashlib
import secrets
from datetime import datetime, timedelta

from fastapi import HTTPException, status
from jose import jwt
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.auth import PasswordResetToken, RefreshToken, Role, User
from app.models.mfa import LoginOTP, TrustedDevice
from app.services.notification_service import send_email_async

_pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

async def generate_password_reset_token(email: str, db: AsyncSession) -> None:
    normalized_email = email.strip().lower()
    result = await db.execute(select(User).where(User.email == normalized_email))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        # Don't throw error to prevent email enumeration
        return

    raw_token = secrets.token_urlsafe(32)
    token = PasswordResetToken(
        user_id=user.id,
        token_hash=hash_token(raw_token),
        expires_at=_utcnow() + timedelta(hours=settings.reset_password_token_expire_hours),
        used=False,
    )
    db.add(token)
    await db.commit()

    reset_link = f"http://localhost:3000/reset-password?token={raw_token}&email={normalized_email}"
    
    email_html = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <title>Password Reset Request</title>
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #2d3748; line-height: 1.6; background-color: #f7fafc; margin: 0; padding: 40px 20px;">
        <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.05), 0 4px 6px -2px rgba(0, 0, 0, 0.02); border: 1px solid #e2e8f0; overflow: hidden;">
            
            <!-- Top Corporate Bar -->
            <div style="background: linear-gradient(135deg, #1a365d 0%, #2a4365 100%); padding: 30px 40px; text-align: center; border-bottom: 4px solid #3182ce;">
                <div style="font-size: 11px; font-weight: 800; color: #90cdf4; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 4px;">SIMON INDIA LIMITED</div>
                <div style="font-size: 20px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px;">Travora</div>
            </div>
            
            <!-- Main Body Card -->
            <div style="padding: 40px;">
                <h2 style="color: #1a202c; font-size: 20px; font-weight: 700; margin-top: 0; margin-bottom: 12px;">Password Reset Request</h2>
                <p style="font-size: 15px; color: #4a5568; margin-top: 0; margin-bottom: 25px; line-height: 1.5;">Hi {user.full_name or 'User'},</p>
                <p style="font-size: 15px; color: #4a5568; margin-top: 0; margin-bottom: 25px; line-height: 1.5;">You recently requested to reset your password for your Travora account. Click the button below to reset it. This link will expire in {settings.reset_password_token_expire_hours} hour(s).</p>
                
                <!-- Portal CTA Button -->
                <div style="margin-top: 30px; text-align: center;">
                    <a href="{reset_link}" style="background-color: #3182ce; color: #ffffff; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; font-size: 15px; box-shadow: 0 4px 6px -1px rgba(49, 130, 206, 0.25); transition: all 0.2s;">
                        Reset Password &rarr;
                    </a>
                </div>

                <div style="margin-top: 35px; padding: 18px 24px; background-color: rgba(226, 232, 240, 0.4); border-left: 4px solid #a0aec0; border-radius: 4px;">
                    <span style="color: #4a5568; font-size: 14px; font-style: italic;">If you did not request a password reset, please ignore this email or contact support if you have concerns.</span>
                </div>
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
    
    # We call fire-and-forget
    import asyncio
    asyncio.create_task(send_email_async(
        to_email=user.email,
        subject="Travora - Password Reset Request",
        body_text=f"Please go to {reset_link} to reset your password.",
        body_html=email_html
    ))

async def reset_password_with_token(email: str, token: str, new_password: str, db: AsyncSession) -> None:
    normalized_email = email.strip().lower()
    result = await db.execute(select(User).where(User.email == normalized_email))
    user = result.scalar_one_or_none()
    
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid request")

    result = await db.execute(
        select(PasswordResetToken).where(
            PasswordResetToken.token_hash == hash_token(token),
            PasswordResetToken.user_id == user.id
        )
    )
    stored_token = result.scalar_one_or_none()
    
    if not stored_token or stored_token.used or stored_token.expires_at <= _utcnow():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired token")

    # Update password and mark token used
    user.hashed_password = hash_password(new_password)
    stored_token.used = True
    await db.commit()


def _utcnow() -> datetime:
    return datetime.utcnow()


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def hash_password(password: str) -> str:
    return _pwd_context.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    try:
        return _pwd_context.verify(password, hashed)
    except Exception:  # noqa: BLE001
        return False


async def authenticate_user(email: str, password: str, db: AsyncSession) -> User:
    normalized_email = email.strip().lower()
    result = await db.execute(select(User).where(User.email == normalized_email))
    user = result.scalar_one_or_none()
    if (
        user is None
        or not user.hashed_password
        or not verify_password(password, user.hashed_password)
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password"
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="User account is inactive"
        )
    return user


def create_access_token(user_id: int, role: Role, mfa_verified: bool) -> str:
    expires_at = _utcnow() + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {
        "sub": str(user_id),
        "role": role.value,
        "mfa_verified": mfa_verified,
        "exp": expires_at,
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


async def create_refresh_token(user_id: int, db: AsyncSession) -> str:
    raw_token = secrets.token_urlsafe(48)
    token = RefreshToken(
        user_id=user_id,
        token_hash=hash_token(raw_token),
        expires_at=_utcnow() + timedelta(days=settings.refresh_token_expire_days),
        revoked=False,
    )
    db.add(token)
    return raw_token


async def rotate_refresh_token(old_token: str, db: AsyncSession) -> tuple[str, User]:
    result = await db.execute(
        select(RefreshToken).where(RefreshToken.token_hash == hash_token(old_token))
    )
    stored_token = result.scalar_one_or_none()
    if (
        stored_token is None
        or stored_token.revoked
        or stored_token.expires_at <= _utcnow()
    ):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")



    user = await db.get(User, stored_token.user_id)
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Inactive user")

    # stored_token.revoked = True

    new_refresh = await create_refresh_token(user.id, db)
    return new_refresh, user


async def revoke_refresh_token(token: str, db: AsyncSession) -> None:
    result = await db.execute(select(RefreshToken).where(RefreshToken.token_hash == hash_token(token)))
    stored_token = result.scalar_one_or_none()
    if stored_token:
        stored_token.revoked = True


def create_mfa_token(user_id: int) -> str:
    # Match the token expiry with the OTP expiry
    expires_at = _utcnow() + timedelta(minutes=settings.otp_expire_minutes)
    payload = {
        "sub": str(user_id),
        "type": "mfa",
        "exp": expires_at,
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


async def generate_and_send_login_otp(user: User, db: AsyncSession) -> None:
    import asyncio
    import random
    import string
    
    alphabet = string.ascii_uppercase + string.digits
    otp_code = ''.join(random.choices(alphabet, k=6))
    
    otp_entry = LoginOTP(
        user_id=user.id,
        otp_hash=hash_password(otp_code),
        expires_at=_utcnow() + timedelta(minutes=settings.otp_expire_minutes),
    )
    db.add(otp_entry)
    await db.commit()
    
    body_text = f"Your login OTP is: {otp_code}. It will expire in {settings.otp_expire_minutes} minutes."
    asyncio.create_task(send_email_async(
        to_email=user.email,
        subject="Travora - Login OTP",
        body_text=body_text,
        body_html=f"<p>Your login OTP is: <strong>{otp_code}</strong>.</p><p>It will expire in {settings.otp_expire_minutes} minutes.</p>"
    ))


async def verify_login_otp(user_id: int, otp_code: str, db: AsyncSession) -> bool:
    result = await db.execute(
        select(LoginOTP)
        .where(LoginOTP.user_id == user_id)
        .order_by(LoginOTP.id.desc())
        .limit(1)
    )
    otp_entry = result.scalar_one_or_none()
    
    if not otp_entry:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No active OTP found")
        
    if otp_entry.expires_at <= _utcnow():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="OTP expired")
        
    if otp_entry.attempts >= 3:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Too many invalid attempts. Please login again.")
        
    # User might type in lowercase, but the generated OTP is always uppercase alphanumeric.
    if not verify_password(otp_code.upper().strip(), otp_entry.otp_hash):
        otp_entry.attempts += 1
        await db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid OTP")
        
    await db.delete(otp_entry)
    await db.commit()
    return True


async def create_trusted_device_token(user_id: int, db: AsyncSession) -> str:
    raw_token = secrets.token_urlsafe(48)
    device = TrustedDevice(
        user_id=user_id,
        token_hash=hash_token(raw_token),
        expires_at=_utcnow() + timedelta(days=settings.trusted_device_expire_days),
    )
    db.add(device)
    return raw_token


async def is_trusted_device(user_id: int, device_token: str | None, db: AsyncSession) -> bool:
    """Check a device cookie against the trusted-devices table.

    On a hit, the trust window slides forward from "now" so an actively used
    device stays remembered instead of re-prompting for OTP mid-expiry-window.
    """
    if not device_token:
        return False

    result = await db.execute(
        select(TrustedDevice).where(TrustedDevice.token_hash == hash_token(device_token))
    )
    device = result.scalar_one_or_none()
    if device is None or device.user_id != user_id or device.expires_at <= _utcnow():
        return False

    device.expires_at = _utcnow() + timedelta(days=settings.trusted_device_expire_days)
    device.last_used_at = _utcnow()
    await db.commit()
    return True
