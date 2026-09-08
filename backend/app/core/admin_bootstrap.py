import logging

from sqlalchemy import select

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.auth import Role, User
from app.services.auth_service import hash_password

logger = logging.getLogger(__name__)


async def ensure_admin_user() -> None:
    normalized_email = settings.admin_email.strip().lower()
    if not normalized_email or not settings.admin_password:
        logger.warning("ADMIN_EMAIL or ADMIN_PASSWORD is not configured; skipping admin bootstrap")
        return

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.email == normalized_email))
        existing = result.scalar_one_or_none()
        if existing is not None:
            updated = False
            if not existing.hashed_password:
                existing.hashed_password = hash_password(settings.admin_password)
                updated = True
            if not existing.is_active:
                existing.is_active = True
                updated = True
            if existing.role != Role.IT_ADMIN:
                existing.role = Role.IT_ADMIN
                updated = True
            if not existing.mfa_verified:
                existing.mfa_verified = True
                updated = True
            if existing.full_name is None and settings.admin_full_name:
                existing.full_name = settings.admin_full_name
                updated = True
            if updated:
                await db.commit()
                logger.info("Admin account `%s` reconciled", normalized_email)
            return

        admin = User(
            email=normalized_email,
            full_name=settings.admin_full_name,
            hashed_password=hash_password(settings.admin_password),
            role=Role.IT_ADMIN,
            mfa_verified=True,
            is_active=True,
        )
        db.add(admin)
        await db.commit()
        logger.info("Bootstrapped admin account `%s`", normalized_email)
