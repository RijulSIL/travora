import hashlib
import secrets
from datetime import datetime, timedelta

from fastapi import HTTPException, status
from jose import jwt
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.auth import RefreshToken, Role, User
from app.models.mfa import LoginOTP, TrustedDevice
from app.services.notification_service import send_email_async

_pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

_OTP_EMAIL_COPY = {
    "login": (
        "Travora - Login OTP",
        "login",
        "Use this code to finish signing in.",
    ),
    "password_reset": (
        "Travora - Password Reset OTP",
        "password reset",
        "Use this code to reset your password. If you did not request this, you can ignore this email.",
    ),
    "password_change": (
        "Travora - Password Change OTP",
        "password change",
        "Use this code to confirm your password change. If you did not request this, please secure your account.",
    ),
}


async def request_password_reset_otp(email: str, db: AsyncSession) -> None:
    normalized_email = email.strip().lower()
    result = await db.execute(select(User).where(User.email == normalized_email))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        # Don't throw error to prevent email enumeration
        return
    await generate_and_send_otp(user, db, purpose="password_reset")


async def confirm_password_reset(email: str, otp_code: str, new_password: str, db: AsyncSession) -> None:
    normalized_email = email.strip().lower()
    result = await db.execute(select(User).where(User.email == normalized_email))
    user = result.scalar_one_or_none()

    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid request")

    await verify_otp(user.id, otp_code, db, purpose="password_reset")

    user.hashed_password = hash_password(new_password)
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


async def generate_and_send_otp(user: User, db: AsyncSession, purpose: str = "login") -> None:
    import asyncio
    import random
    import string

    alphabet = string.ascii_uppercase + string.digits
    otp_code = ''.join(random.choices(alphabet, k=6))

    otp_entry = LoginOTP(
        user_id=user.id,
        otp_hash=hash_password(otp_code),
        expires_at=_utcnow() + timedelta(minutes=settings.otp_expire_minutes),
        purpose=purpose,
    )
    db.add(otp_entry)
    await db.commit()

    subject, label, note = _OTP_EMAIL_COPY.get(purpose, _OTP_EMAIL_COPY["login"])
    body_text = f"Your {label} OTP is: {otp_code}. It will expire in {settings.otp_expire_minutes} minutes. {note}"
    asyncio.create_task(send_email_async(
        to_email=user.email,
        subject=subject,
        body_text=body_text,
        body_html=(
            f"<p>Your {label} OTP is: <strong>{otp_code}</strong>.</p>"
            f"<p>It will expire in {settings.otp_expire_minutes} minutes.</p>"
            f"<p>{note}</p>"
        ),
    ))


async def generate_and_send_login_otp(user: User, db: AsyncSession) -> None:
    await generate_and_send_otp(user, db, purpose="login")


async def verify_otp(user_id: int, otp_code: str, db: AsyncSession, purpose: str = "login") -> bool:
    result = await db.execute(
        select(LoginOTP)
        .where(LoginOTP.user_id == user_id, LoginOTP.purpose == purpose)
        .order_by(LoginOTP.id.desc())
        .limit(1)
    )
    otp_entry = result.scalar_one_or_none()

    if not otp_entry:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No active OTP found")

    if otp_entry.expires_at <= _utcnow():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="OTP expired")

    if otp_entry.attempts >= 3:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Too many invalid attempts. Please request a new code.",
        )

    # User might type in lowercase, but the generated OTP is always uppercase alphanumeric.
    if not verify_password(otp_code.upper().strip(), otp_entry.otp_hash):
        otp_entry.attempts += 1
        await db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid OTP")

    await db.delete(otp_entry)
    await db.commit()
    return True


async def verify_login_otp(user_id: int, otp_code: str, db: AsyncSession) -> bool:
    return await verify_otp(user_id, otp_code, db, purpose="login")


async def request_password_change_otp(user_id: int, current_password: str, db: AsyncSession) -> None:
    user = await db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if not user.hashed_password or not verify_password(current_password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Current password is incorrect")
    await generate_and_send_otp(user, db, purpose="password_change")


async def confirm_password_change(user_id: int, otp_code: str, new_password: str, db: AsyncSession) -> None:
    user = await db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    await verify_otp(user_id, otp_code, db, purpose="password_change")

    user.hashed_password = hash_password(new_password)
    await db.commit()


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
