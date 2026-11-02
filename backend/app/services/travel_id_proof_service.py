"""The traveller's ID on a travel request: their full name exactly as on the ID, which ID it is,
and a copy of it (PDF or photo). All three are required on every request; the form fills them in
from the traveller's previous request. Approvers, the Travel Desk, the travel agent (through the
booking link) and the traveller can see them — tickets must be issued in the name on the ID.

The file is uploaded first (store_id_proof) and the request then refers to it by `ref` — the
file's content hash plus extension, kept per user — so reusing last time's ID needs no new upload.
"""

import hashlib
import re
from pathlib import Path

from fastapi import HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.travel_request import TravelRequest

ID_TYPES = {
    "AADHAAR": "Aadhaar",
    "PAN": "PAN card",
    "PASSPORT": "Passport",
    "DRIVING_LICENCE": "Driving licence",
    "VOTER_ID": "Voter ID",
    "OTHER": "Other ID",
}
_CONTENT_TYPES = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".heic": "image/heic",
}
_UPLOAD_TYPES = {"application/pdf", "image/jpeg", "image/png", "image/heic", "image/heif"}
_MAX_BYTES = 10 * 1024 * 1024
_REF = re.compile(r"^[0-9a-f]{64}\.(pdf|jpg|jpeg|png|heic)$")


def _folder(user_id: int) -> Path:
    return Path(settings.travel_id_proof_storage_dir) / str(user_id)


def id_proof_path(user_id: int, ref: str | None) -> Path | None:
    """Where a user's stored ID file is, or None for a ref that isn't one of their files."""
    if not ref or not _REF.match(ref):
        return None
    path = _folder(user_id) / ref
    return path if path.is_file() else None


async def store_id_proof(user_id: int, file: UploadFile) -> dict:
    """Saves an uploaded ID (PDF, JPG, PNG or HEIC, up to 10 MB) for this user."""
    content = await file.read()
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in _CONTENT_TYPES or (file.content_type or "") not in _UPLOAD_TYPES:
        raise HTTPException(status_code=415, detail="Upload the ID as a PDF, JPG, PNG or HEIC file")
    if not content:
        raise HTTPException(status_code=422, detail="The uploaded file is empty")
    if len(content) > _MAX_BYTES:
        raise HTTPException(status_code=413, detail="The ID file can be up to 10 MB")
    folder = _folder(user_id)
    folder.mkdir(parents=True, exist_ok=True)
    ref = f"{hashlib.sha256(content).hexdigest()}{suffix}"
    (folder / ref).write_bytes(content)
    return {"ref": ref, "filename": (file.filename or f"id{suffix}")[:255], "content_type": _CONTENT_TYPES[suffix]}


def clean_traveller_id(user_id: int, name: str | None, id_type: str | None, ref: str | None, filename: str | None) -> dict:
    """The traveller ID fields for a new request — all required."""
    name = " ".join((name or "").split())
    if len(name) < 2:
        raise HTTPException(status_code=422, detail="Enter your full name exactly as it appears on your ID")
    if len(name) > 255:
        raise HTTPException(status_code=422, detail="The name as per ID is too long")
    id_type = (id_type or "").strip().upper()
    if id_type not in ID_TYPES:
        raise HTTPException(status_code=422, detail="Choose which ID you're attaching")
    if id_proof_path(user_id, ref) is None:
        raise HTTPException(status_code=422, detail="Attach a copy of your ID")
    suffix = Path(ref).suffix
    return {
        "id_name": name,
        "id_type": id_type,
        "id_proof_ref": ref,
        "id_proof_filename": (filename or "").strip()[:255] or f"id{suffix}",
        "id_proof_content_type": _CONTENT_TYPES[suffix],
    }


async def last_traveller_id(user_id: int, db: AsyncSession) -> dict | None:
    """What the form fills in: the ID on this person's latest request (if its file still exists)."""
    row = (
        await db.execute(
            select(TravelRequest)
            .where(TravelRequest.employee_user_id == user_id, TravelRequest.id_name.is_not(None))
            .order_by(TravelRequest.id.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    has_file = id_proof_path(user_id, row.id_proof_ref) is not None
    return {
        "id_name": row.id_name,
        "id_type": row.id_type,
        "id_proof_ref": row.id_proof_ref if has_file else None,
        "id_proof_filename": row.id_proof_filename if has_file else None,
    }


def id_type_label(code: str | None) -> str | None:
    return ID_TYPES.get(code or "", code) if code else None
