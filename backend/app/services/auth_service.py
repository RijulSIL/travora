import hashlib
import math
import secrets
from datetime import datetime, timedelta

from fastapi import HTTPException, status
from jose import jwt
from passlib.context import CryptContext
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.auth import LoginFailure, RefreshToken, Role, User
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


# Every wrong-code answer from the reset page, whether or not the email has an account (and
# whether the code was wrong, old or tried too often), so the page can't be used to find out
# which emails have accounts.
RESET_CODE_ERROR = "That code is wrong or has expired. Check the latest email or request a new code."


def _refuse_temporary_password(new_password: str) -> None:
    """Welcome@123 is printed in every welcome email, so nobody may go back to it. Checked before
    the code, so choosing it doesn't use up one of the tries."""
    from app.services.welcome_service import TEMPORARY_PASSWORD

    if new_password == TEMPORARY_PASSWORD:
        raise HTTPException(status_code=422, detail="Choose a password other than the temporary one")


async def confirm_password_reset(email: str, otp_code: str, new_password: str, db: AsyncSession) -> None:
    _refuse_temporary_password(new_password)
    normalized_email = email.strip().lower()
    result = await db.execute(select(User).where(User.email == normalized_email))
    user = result.scalar_one_or_none()

    if not user or not user.is_active:
        # Same work as checking a real code, so the answer doesn't come back noticeably faster.
        verify_password(otp_code, _dummy_hash())
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=RESET_CODE_ERROR)

    try:
        await verify_otp(user.id, otp_code, db, purpose="password_reset")
    except HTTPException as exc:
        if exc.status_code == status.HTTP_401_UNAUTHORIZED:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=RESET_CODE_ERROR) from None
        raise

    user.hashed_password = hash_password(new_password)
    # Their own password now: no longer on the temporary one from the welcome email.
    user.must_change_password = False
    # Whoever was signed in with the old password is signed out everywhere.
    await end_sessions(user, db)
    # A reset also lifts a sign-in lockout.
    await db.execute(delete(LoginFailure).where(LoginFailure.email == normalized_email[:255]))
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


_DUMMY_HASH: str | None = None


def _dummy_hash() -> str:
    """A hash to check against when there's no account, so a made-up email takes as long to
    answer as a wrong password."""
    global _DUMMY_HASH
    if _DUMMY_HASH is None:
        _DUMMY_HASH = hash_password(secrets.token_urlsafe(16))
    return _DUMMY_HASH


# Wrong passwords in a row before an email can't sign in for a while. A correct password or a
# password reset clears the count. Counted per email, known or not (see LoginFailure).
MAX_FAILED_LOGINS = 5
LOGIN_LOCKOUT = timedelta(minutes=15)


def _locked_out(locked_until: datetime, now: datetime) -> HTTPException:
    minutes = max(1, math.ceil((locked_until - now).total_seconds() / 60))
    return HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail=f"Too many wrong passwords. Try again in {minutes} minute{'' if minutes == 1 else 's'}.",
    )


async def authenticate_user(email: str, password: str, db: AsyncSession) -> User:
    normalized_email = email.strip().lower()
    failure_key = normalized_email[:255]
    failure = (
        await db.execute(select(LoginFailure).where(LoginFailure.email == failure_key))
    ).scalar_one_or_none()
    now = _utcnow()
    # Locked: refused even with the right password, until the time is up.
    if failure is not None and failure.locked_until is not None and failure.locked_until > now:
        raise _locked_out(failure.locked_until, now)

    result = await db.execute(select(User).where(User.email == normalized_email))
    user = result.scalar_one_or_none()
    if user is None or not user.hashed_password:
        verify_password(password, _dummy_hash())
        password_ok = False
    else:
        password_ok = verify_password(password, user.hashed_password)
    if not password_ok:
        if failure is None:
            failure = LoginFailure(email=failure_key, failed_count=0)
            db.add(failure)
        failure.failed_count = (failure.failed_count or 0) + 1
        failure.last_failed_at = now
        if failure.failed_count >= MAX_FAILED_LOGINS:
            # The count starts again once the lockout is over.
            failure.failed_count = 0
            failure.locked_until = now + LOGIN_LOCKOUT
            await db.commit()
            raise _locked_out(failure.locked_until, now)
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password"
        )
    if failure is not None:
        await db.delete(failure)
        await db.commit()
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
        # Whole seconds; compared with User.password_changed_at (rbac.get_current_claims).
        "iat": _utcnow().replace(microsecond=0),
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


# How long a just-swapped refresh token is still accepted. Covers requests that were already on
# their way with it: a page's double load in development, two tabs refreshing at the same moment.
REFRESH_ROTATION_GRACE = timedelta(seconds=30)


async def rotate_refresh_token(old_token: str, db: AsyncSession) -> tuple[str, User]:
    """Swap a refresh token for a new one and cancel the old one, so a copied token stops
    working as soon as the real browser refreshes. A token swapped less than
    REFRESH_ROTATION_GRACE ago is still accepted (and gets its own new token) rather than
    logging the user out; one cancelled by logout, or swapped longer ago, is refused."""
    result = await db.execute(
        select(RefreshToken).where(RefreshToken.token_hash == hash_token(old_token))
    )
    stored_token = result.scalar_one_or_none()
    now = _utcnow()
    if stored_token is None or stored_token.expires_at <= now:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")
    if stored_token.revoked and (
        stored_token.rotated_at is None or now - stored_token.rotated_at > REFRESH_ROTATION_GRACE
    ):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")

    user = await db.get(User, stored_token.user_id)
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Inactive user")

    if not stored_token.revoked:
        stored_token.revoked = True
        stored_token.rotated_at = now

    new_refresh = await create_refresh_token(user.id, db)
    return new_refresh, user


async def revoke_refresh_token(token: str, db: AsyncSession) -> None:
    result = await db.execute(select(RefreshToken).where(RefreshToken.token_hash == hash_token(token)))
    stored_token = result.scalar_one_or_none()
    if stored_token:
        stored_token.revoked = True


async def end_sessions(user: User, db: AsyncSession, keep_refresh_tokens: tuple[str | None, ...] = ()) -> None:
    """After a password reset or change: every access token issued before now stops working,
    and every refresh token is cancelled (no rotation grace) except `keep_refresh_tokens` — the
    session that made the change, which then just refreshes. Doesn't commit."""
    user.password_changed_at = _utcnow().replace(microsecond=0)
    keep = [hash_token(t) for t in keep_refresh_tokens if t]
    statement = update(RefreshToken).where(RefreshToken.user_id == user.id)
    if keep:
        statement = statement.where(RefreshToken.token_hash.notin_(keep))
    await db.execute(statement.values(revoked=True, rotated_at=None).execution_options(synchronize_session=False))


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
    import string

    alphabet = string.ascii_uppercase + string.digits
    # secrets, not random: codes must not be predictable from earlier ones.
    otp_code = ''.join(secrets.choice(alphabet) for _ in range(6))

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


async def confirm_password_change(
    user_id: int,
    otp_code: str,
    new_password: str,
    db: AsyncSession,
    keep_refresh_tokens: tuple[str | None, ...] = (),
) -> None:
    user = await db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    _refuse_temporary_password(new_password)

    await verify_otp(user_id, otp_code, db, purpose="password_change")

    user.hashed_password = hash_password(new_password)
    # Their own password now: no longer on the temporary one from the welcome email.
    user.must_change_password = False
    # Signed out everywhere else; this session stays signed in.
    await end_sessions(user, db, keep_refresh_tokens)
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
