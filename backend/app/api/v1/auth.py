from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.schemas.common import (
    ForgotPasswordRequest,
    LoginRequest,
    MFAVerifyRequest,
    ResetPasswordRequest,
    TokenResponse,
)
from app.services.auth_service import (
    authenticate_user,
    create_access_token,
    create_mfa_token,
    create_refresh_token,
    create_trusted_device_token,
    generate_and_send_login_otp,
    generate_password_reset_token,
    is_trusted_device,
    reset_password_with_token,
    revoke_refresh_token,
    rotate_refresh_token,
    verify_login_otp,
)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/forgot-password")
async def forgot_password(
    payload: ForgotPasswordRequest,
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    await generate_password_reset_token(payload.email, db)
    return {"message": "If an account with that email exists, a password reset link has been sent."}


@router.post("/reset-password")
async def reset_password(
    payload: ResetPasswordRequest,
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    await reset_password_with_token(payload.email, payload.token, payload.new_password, db)
    return {"message": "Password successfully reset."}


def _set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key="refresh_token",
        value=token,
        httponly=True,
        samesite=settings.refresh_cookie_samesite,
        secure=settings.refresh_cookie_secure,
        max_age=settings.refresh_token_expire_days * 24 * 60 * 60,
        path="/",
    )


def _set_device_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key="device_token",
        value=token,
        httponly=True,
        samesite=settings.refresh_cookie_samesite,
        secure=settings.refresh_cookie_secure,
        max_age=settings.trusted_device_expire_days * 24 * 60 * 60,
        path="/",
    )


@router.post("/login")
async def login(
    payload: LoginRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
    device_token: str | None = Cookie(default=None),
) -> dict:
    user = await authenticate_user(payload.email, payload.password, db)

    if await is_trusted_device(user.id, device_token, db):
        # Already stepped up on this device within the trust window — skip OTP.
        refresh_token = await create_refresh_token(user.id, db)
        await db.commit()
        access_token = create_access_token(user.id, user.role, mfa_verified=True)
        _set_refresh_cookie(response, refresh_token)
        return {
            "access_token": access_token,
            "token_type": "bearer",
            "user": {
                "id": user.id,
                "email": user.email,
                "full_name": user.full_name,
                "role": user.role.value,
            },
            "refresh_token": refresh_token,
        }

    # Generate and send OTP for MFA
    await generate_and_send_login_otp(user, db)
    mfa_token = create_mfa_token(user.id)

    # Return 202 Accepted, indicating step-up is required
    response.status_code = status.HTTP_202_ACCEPTED
    return {
        "mfa_required": True,
        "mfa_token": mfa_token,
        "message": "OTP sent to email"
    }


@router.post("/login/verify-otp", response_model=TokenResponse)
async def verify_otp(
    payload: MFAVerifyRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> dict:
    from jose import jwt
    try:
        claims = jwt.decode(payload.mfa_token, settings.secret_key, algorithms=[settings.algorithm])
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid MFA token") from exc
        
    if claims.get("type") != "mfa":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type")
        
    user_id = int(claims["sub"])
    
    await verify_login_otp(user_id, payload.otp_code, db)
    
    from app.models.auth import User
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
        
    refresh_token = await create_refresh_token(user.id, db)
    device_token = await create_trusted_device_token(user.id, db)
    await db.commit()

    # Since MFA is now verified for this session, we set mfa_verified to True
    access_token = create_access_token(user.id, user.role, mfa_verified=True)
    _set_refresh_cookie(response, refresh_token)
    _set_device_cookie(response, device_token)

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "email": user.email,
            "full_name": user.full_name,
            "role": user.role.value,
        },
        "refresh_token": refresh_token,
    }



@router.post("/refresh", response_model=TokenResponse)
async def refresh_access_token(
    response: Response,
    refresh_token: str | None = Cookie(default=None),
    x_refresh_token: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> dict:
    token = refresh_token or x_refresh_token
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing refresh token")



    new_refresh, user = await rotate_refresh_token(token, db)
    await db.commit()
    _set_refresh_cookie(response, new_refresh)
    access_token = create_access_token(user.id, user.role, user.mfa_verified)
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "email": user.email,
            "full_name": user.full_name,
            "role": user.role.value,
        },
        "refresh_token": new_refresh,
    }


@router.post("/logout")
async def logout(
    response: Response,
    refresh_token: str | None = Cookie(default=None),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    if refresh_token:
        await revoke_refresh_token(refresh_token, db)
        await db.commit()
    response.delete_cookie("refresh_token", samesite=settings.refresh_cookie_samesite)
    return {"status": "ok"}
