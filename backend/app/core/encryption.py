import base64
import hashlib

from cryptography.fernet import Fernet

from app.core.config import settings


def _derive_key() -> bytes:
    if settings.encryption_key:
        return settings.encryption_key.encode()
    digest = hashlib.sha256(settings.secret_key.encode()).digest()
    return base64.urlsafe_b64encode(digest)


_fernet = Fernet(_derive_key())


def encrypt_text(value: str | None) -> str | None:
    if value is None or value == "":
        return value
    return _fernet.encrypt(value.encode()).decode()


def decrypt_text(value: str | None) -> str | None:
    if value is None or value == "":
        return value
    return _fernet.decrypt(value.encode()).decode()
