"""Relocation approval — the prerequisite for a relocation reimbursement claim.

An employee starts a relocation claim from New Claim -> Relocation Claim. Before claiming they need
an approved RelocationRequest, which comes about one of two ways (`source`):

* REQUESTED — they filled in the relocation form, and it went through the configurable
  Relocation Approval workflow (default Recruiter -> CEO -> HRBP -> Payroll, see
  workflow_service.RELOCATION_REQUEST_DEFAULT_STAGES); APPROVED once its last stage approves.
* PRIOR_APPROVAL — they already had approval: the same form plus the evidence (PDF/screenshot).
  It's APPROVED straight away; the evidence is reviewed by the claim's approvers and Finance.

Any number of claims can then be raised against an approved request (ClaimDraft.relocation_request_id).
"""

import enum
from datetime import datetime
from decimal import Decimal

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class RelocationRequestStatus(str, enum.Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    CANCELLED = "CANCELLED"


class RelocationSource(str, enum.Enum):
    REQUESTED = "REQUESTED"
    PRIOR_APPROVAL = "PRIOR_APPROVAL"


class RelocationRequest(Base):
    __tablename__ = "relocation_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    employee_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default=RelocationRequestStatus.PENDING.value)
    origin_city: Mapped[str] = mapped_column(String(128), nullable=False)
    destination_city: Mapped[str] = mapped_column(String(128), nullable=False)
    # Amount to be approved (REQUESTED) or already approved (PRIOR_APPROVAL); claims are
    # compared against it, never capped by it.
    estimated_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    # The rest of the form (travel type, project code, travel date, family members, notes) — kept
    # as JSON so the form's fields can change without a schema migration. Older requests have a
    # planned_move_date instead of travel_date (relocation_service._details_out reads either).
    details: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    # PRIOR_APPROVAL only: the approval evidence the employee uploaded.
    evidence_path: Mapped[str | None] = mapped_column(String(512))
    evidence_filename: Mapped[str | None] = mapped_column(String(255))
    evidence_content_type: Mapped[str | None] = mapped_column(String(128))
    current_approval_stage: Mapped[int | None] = mapped_column(Integer)
    rejection_reason: Mapped[str | None] = mapped_column(Text)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class RelocationApprovalStage(Base):
    """One stage of a REQUESTED relocation's approval chain — same shape and SLA bookkeeping as
    TravelRequestApprovalStage (statuses PENDING / APPROVED / REJECTED / NOT_STARTED / SLA_SKIPPED)."""

    __tablename__ = "relocation_approval_stages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    relocation_request_id: Mapped[int] = mapped_column(
        ForeignKey("relocation_requests.id", ondelete="CASCADE"), nullable=False, index=True
    )
    stage_number: Mapped[int] = mapped_column(Integer, nullable=False)
    stage_label: Mapped[str] = mapped_column(String(128), nullable=False)
    required_role: Mapped[str | None] = mapped_column(String(64), index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="NOT_STARTED")
    sla_deadline_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_notified_at: Mapped[datetime | None] = mapped_column(DateTime)
    sla_breached_at: Mapped[datetime | None] = mapped_column(DateTime)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime)
    decided_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    comment: Mapped[str | None] = mapped_column(Text)
