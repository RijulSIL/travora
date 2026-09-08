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
    __tablename__ = "advance_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employee_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    purpose: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default=AdvanceRequestStatus.IN_APPROVAL.value)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )


class AdvanceApprovalStage(Base):
    __tablename__ = "advance_approval_stages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    advance_id: Mapped[int] = mapped_column(
        ForeignKey("advance_requests.id", ondelete="CASCADE"), nullable=False, index=True
    )
    stage_number: Mapped[int] = mapped_column(Integer, nullable=False)
    stage_label: Mapped[str] = mapped_column(String(128), nullable=False)
    required_role: Mapped[str | None] = mapped_column(String(64), index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default=ClaimApprovalStageStatus.PENDING.value)
    sla_deadline_at: Mapped[datetime | None] = mapped_column(DateTime)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime)
    decided_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    comment: Mapped[str | None] = mapped_column(Text)


class ExceptionRequest(Base):
    __tablename__ = "exception_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    claim_id: Mapped[int] = mapped_column(ForeignKey("claim_drafts.id"), nullable=False, index=True)
    requested_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    exception_type: Mapped[str] = mapped_column(String(128), nullable=False)
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
