from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class ApprovalActionBody(BaseModel):
    comment: str | None = None


class SendBackBody(BaseModel):
    comment: str = Field(..., min_length=1)


class RejectBody(BaseModel):
    reason: str = Field(..., min_length=1)


class ModifyAmountBody(BaseModel):
    new_amount: Decimal = Field(..., gt=Decimal("0"))
    comment: str | None = None


class PaymentBody(BaseModel):
    utr_reference: str = Field(..., min_length=1)
    amount: Decimal = Field(..., ge=Decimal("0"))
    tds_deduction: Decimal = Field(default=Decimal("0"), ge=Decimal("0"))
    advance_deducted: Decimal = Field(default=Decimal("0"), ge=Decimal("0"))


class ExceptionRequestIn(BaseModel):
    # Always required — this endpoint raises an exception against an existing claim's
    # expense line. Travel-request exceptions are created via a separate path
    # (create_travel_request_with_exception) that never goes through this schema.
    claim_id: int
    exception_type: str = Field(..., min_length=1, max_length=128)
    description: str | None = None


class ExceptionRequestOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    claim_id: int | None = None
    travel_request_id: int | None = None
    requested_by_user_id: int
    exception_type: str
    exception_types: list[str] = Field(default_factory=list)
    description: str | None
    status: str
    decided_at: datetime | None = None
    decided_by_user_id: int | None = None
    decision_comment: str | None = None
    created_at: datetime


class ExceptionDecisionBody(BaseModel):
    approve: bool
    comment: str | None = None


class AdvanceGrantIn(BaseModel):
    # Finance identifies the employee by their employee ID or email — there's no employee
    # picker/search UI, so this is resolved to a user server-side (see create_advance_grant).
    employee_identifier: str = Field(..., min_length=1)
    amount: Decimal = Field(..., gt=Decimal("0"))
    purpose: str | None = None
    # False (the default) makes an already-active advance for this employee come back as a 409
    # instead of silently creating a second grant — the frontend re-submits with this set once
    # Finance confirms they want to top up the existing one rather than start a new one.
    confirm_merge: bool = False


class AdvanceUpdateIn(BaseModel):
    # The employee an advance was granted to is deliberately not editable here — correcting
    # that means it went to the wrong person, which is a delete-and-regrant, not an edit.
    amount: Decimal = Field(..., gt=Decimal("0"))
    purpose: str | None = None


class AdvanceSettleIn(BaseModel):
    amount: Decimal = Field(..., gt=Decimal("0"))
    note: str | None = None


class AdvanceRequestOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    employee_user_id: int
    amount: Decimal
    purpose: str | None
    status: str
    created_by_user_id: int | None = None
    created_at: datetime


class WorkflowConfigOut(BaseModel):
    config: dict
    # Populated only by PUT (a save) — how many already in-flight claim/travel-request stages
    # and exception approvals were just reassigned to a newly-configured role because they were
    # sitting at a stage/position whose route_role changed. See
    # workflow_service._migrate_inflight_approvals.
    reassigned: dict[str, int] = Field(default_factory=dict)


class WorkflowConfigUpdate(BaseModel):
    config: dict


class ClaimTimelineEventOut(BaseModel):
    event: str
    actor: str | None = None
    role: str | None = None
    timestamp: datetime
    comment: str | None = None
    stage: int | None = None
    utr: str | None = None
    is_auto: bool = False


class NotificationTemplateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    template_key: str
    channel: str
    subject: str
    body_text: str
    updated_at: datetime


class NotificationTemplateUpdate(BaseModel):
    subject: str | None = None
    body_text: str | None = None


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    sqlid: int
    user_id: int
    title: str
    body: str | None
    link: str | None
    category: str
    is_read: bool
    created_at: datetime


class NotificationReadAllOut(BaseModel):
    marked_count: int


class NotificationUnreadCountOut(BaseModel):
    count: int
