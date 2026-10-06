import enum
from datetime import datetime
from decimal import Decimal

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class ClaimApprovalStageStatus(str, enum.Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    SENT_BACK = "SENT_BACK"
    REJECTED = "REJECTED"


class AdvanceRequestStatus(str, enum.Enum):
    IN_APPROVAL = "IN_APPROVAL"
    APPROVED = "APPROVED"
    DISBURSED = "DISBURSED"
    SETTLED = "SETTLED"
    REJECTED = "REJECTED"
    SENT_BACK = "SENT_BACK"


class ExceptionRequestStatus(str, enum.Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


class NotificationCategory(str, enum.Enum):
    APPROVAL_REQUIRED = "APPROVAL_REQUIRED"
    CLAIM_UPDATE = "CLAIM_UPDATE"
    PAYMENT = "PAYMENT"
    SLA_BREACH = "SLA_BREACH"
    ADVANCE = "ADVANCE"
    EXCEPTION = "EXCEPTION"
    SYSTEM = "SYSTEM"


class ClaimApprovalStage(Base):
    __tablename__ = "claim_approval_stages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    claim_id: Mapped[int] = mapped_column(ForeignKey("claim_drafts.id", ondelete="CASCADE"), nullable=False, index=True)
    stage_number: Mapped[int] = mapped_column(Integer, nullable=False)
    stage_label: Mapped[str] = mapped_column(String(128), nullable=False)
    required_role: Mapped[str | None] = mapped_column(String(64), index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default=ClaimApprovalStageStatus.PENDING.value)
    sla_deadline_at: Mapped[datetime | None] = mapped_column(DateTime)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime)
    decided_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    comment: Mapped[str | None] = mapped_column(Text)


class AdvanceRequest(Base):
    """A cash advance Finance grants directly to an employee — no approval chain (Finance is
    both the grantor and the only role that can ever see or manage these). An employee has at
    most one *active* grant at a time (see workflow_service.create_advance_grant) — a new grant
    while one is still active tops it up instead of creating a second row, so a fully-drawn
    grant can never look active again just because the employee gets a new one later."""

    __tablename__ = "advance_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employee_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    # `amount` is the current remaining allocation on THIS grant — both a claim payment and a
    # Settle Up draw it down directly (see workflow_service._draw_down_advance), crediting
    # `consumed_via_claims`/`consumed_via_settlement` respectively, so it's always the real
    # remaining figure. `granted_amount` is frozen at grant time (only an explicit Edit, or a
    # top-up merge, changes it) so the archive view can always show what was actually granted.
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    granted_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    consumed_via_claims: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    consumed_via_settlement: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    purpose: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default=AdvanceRequestStatus.APPROVED.value)
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )


class ExceptionRequest(Base):
    __tablename__ = "exception_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    claim_id: Mapped[int | None] = mapped_column(ForeignKey("claim_drafts.id"), nullable=True, index=True)
    travel_request_id: Mapped[int | None] = mapped_column(ForeignKey("travel_requests.id"), nullable=True, index=True)
    requested_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    # Primary/first type — kept for backward-compat filtering and display where a single
    # label is enough. `exception_types` is the source of truth for what this request covers.
    exception_type: Mapped[str] = mapped_column(String(128), nullable=False)
    # A travel request that trips multiple distinct policy checks at once (e.g. both
    # short-notice flight booking AND air-travel-locked-for-level) still gets exactly one
    # ExceptionRequest — this holds every type it covers, and the approval chain built for
    # it is the union of each type's required-approver roles (see _merge_exception_chains).
    exception_types: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default=ExceptionRequestStatus.PENDING.value)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime)
    decided_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    decision_comment: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class ExceptionApproval(Base):
    __tablename__ = "exception_approvals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    exception_request_id: Mapped[int] = mapped_column(
        ForeignKey("exception_requests.id", ondelete="CASCADE"), nullable=False, index=True
    )
    required_role: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default=ExceptionRequestStatus.PENDING.value)
    acted_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    acted_at: Mapped[datetime | None] = mapped_column(DateTime)
    comment: Mapped[str | None] = mapped_column(Text)


class WorkflowConfigRow(Base):
    __tablename__ = "workflow_config"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    config_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )
    updated_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))


class NotificationTemplate(Base):
    __tablename__ = "notification_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    template_key: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    channel: Mapped[str] = mapped_column(String(32), nullable=False, default="EMAIL")
    subject: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    body_text: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )


class Notification(Base):
    __tablename__ = "notifications"

    sqlid: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str | None] = mapped_column(Text)
    link: Mapped[str | None] = mapped_column(String(512))
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    is_read: Mapped[bool] = mapped_column(nullable=False, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now(), index=True)
