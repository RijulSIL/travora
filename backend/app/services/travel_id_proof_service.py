"""The traveller's ID on a travel request: their full name exactly as on the ID, which ID it is,
and a copy of it (PDF or photo). All three are required on every request. Approvers, the Travel
Desk, the travel agent (through the booking link) and the traveller can see them — tickets must be
issued in the name on the ID.

Everyone also keeps a traveller profile on their account: their meal preference (veg / non-veg)
and their ID, given on the setup screen after their first sign-in and changeable on My profile.
The travel request form is filled in from it (form_defaults); the ID can be changed on a request,
and optionally saved back as the profile's. A request also carries the meal preference for that
trip and, optionally, a passport number and expiry date (needed for international travel).

The file is uploaded first (store_id_proof) and the request then refers to it by `ref` — the
file's content hash plus extension, kept per user — so reusing the saved ID needs no new upload.
"""

import hashlib
import re
from datetime import date
from pathlib import Path

from fastapi import HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.timezone import format_date, now_ist
from app.models.auth import User
from app.models.travel_request import TravelRequest

MEAL_PREFERENCES = {"VEG": "Veg", "NON_VEG": "Non-veg"}
# Letters and digits only once spaces/dashes are dropped: an Indian passport is a letter and 7
# digits (A1234567); other countries' run 6–9 characters, so allow a little either side.
_PASSPORT = re.compile(r"^[A-Z0-9]{5,20}$")

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


def clean_meal_preference(value: str | None) -> str:
    meal = (value or "").strip().upper().replace("-", "_").replace(" ", "_")
    if meal not in MEAL_PREFERENCES:
        raise HTTPException(status_code=422, detail="Choose your meal preference: veg or non-veg")
    return meal


def clean_passport(number: str | None, expiry: date | None) -> dict:
    """The optional passport on a travel request: a number, and its expiry date if known. Neither
    is required, but an expiry needs a number, and an expired passport isn't accepted."""
    number = re.sub(r"[\s-]", "", number or "").upper()
    if not number:
        if expiry is not None:
            raise HTTPException(status_code=422, detail="Enter the passport number for that expiry date")
        return {"passport_number": None, "passport_expiry": None}
    if not _PASSPORT.match(number):
        raise HTTPException(status_code=422, detail="Enter the passport number as printed: letters and digits only")
    if expiry is not None and expiry < now_ist().date():
        raise HTTPException(status_code=422, detail=f"This passport expired on {format_date(expiry)}")
    return {"passport_number": number, "passport_expiry": expiry}


def saved_traveller_id(user: User) -> dict | None:
    """The ID on this person's profile, or None if they haven't given one (or its file is gone)."""
    if not user.id_name or id_proof_path(user.id, user.id_proof_ref) is None:
        return None
    return {
        "id_name": user.id_name,
        "id_type": user.id_type,
        "id_proof_ref": user.id_proof_ref,
        "id_proof_filename": user.id_proof_filename,
    }


def needs_traveller_profile(user: User) -> bool:
    """Whether the app asks for their meal preference and ID before anything else."""
    return not user.meal_preference or saved_traveller_id(user) is None


def save_traveller_id_to_profile(user: User, ident: dict) -> None:
    """Makes a cleaned ID (clean_traveller_id's output) the one on their profile."""
    user.id_name = ident["id_name"]
    user.id_type = ident["id_type"]
    user.id_proof_ref = ident["id_proof_ref"]
    user.id_proof_filename = ident["id_proof_filename"]
    user.id_proof_content_type = ident["id_proof_content_type"]


async def _latest_request(user_id: int, db: AsyncSession, *conditions) -> TravelRequest | None:
    return (
        await db.execute(
            select(TravelRequest)
            .where(TravelRequest.employee_user_id == user_id, *conditions)
            .order_by(TravelRequest.id.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def form_defaults(user_id: int, db: AsyncSession) -> dict:
    """What the travel request form fills in: the ID and meal preference from their profile
    (their latest request's ID if the profile has none yet), the passport from their latest
    request that had one, and the profile's own ID as `saved_id` — so the form can offer to save
    a changed ID as the profile's."""
    user = await db.get(User, user_id)
    saved = saved_traveller_id(user) if user else None
    ident = saved
    if ident is None:
        row = await _latest_request(user_id, db, TravelRequest.id_name.is_not(None))
        if row is not None:
            has_file = id_proof_path(user_id, row.id_proof_ref) is not None
            ident = {
                "id_name": row.id_name,
                "id_type": row.id_type,
                "id_proof_ref": row.id_proof_ref if has_file else None,
                "id_proof_filename": row.id_proof_filename if has_file else None,
            }
    meal = user.meal_preference if user else None
    if not meal:
        row = await _latest_request(user_id, db, TravelRequest.meal_preference.is_not(None))
        meal = row.meal_preference if row else None
    passport = await _latest_request(user_id, db, TravelRequest.passport_number.is_not(None))
    expiry = passport.passport_expiry if passport else None
    return {
        **(ident or {"id_name": None, "id_type": None, "id_proof_ref": None, "id_proof_filename": None}),
        "meal_preference": meal,
        "passport_number": passport.passport_number if passport else None,
        # An expired one isn't filled in: it would only be refused.
        "passport_expiry": expiry.isoformat() if expiry and expiry >= now_ist().date() else None,
        "saved_id": saved,
    }


def id_type_label(code: str | None) -> str | None:
    return ID_TYPES.get(code or "", code) if code else None


def meal_label(code: str | None) -> str | None:
    return MEAL_PREFERENCES.get(code or "", code) if code else None
