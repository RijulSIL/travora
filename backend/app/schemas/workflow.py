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


class ExceptionRequestIn(BaseModel):
    claim_id: int | None = None
    exception_type: str = Field(..., min_length=1, max_length=128)
    description: str | None = None


class ExceptionRequestOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    claim_id: int
    requested_by_user_id: int
    exception_type: str
    description: str | None
    status: str
    decided_at: datetime | None = None
    decided_by_user_id: int | None = None
    decision_comment: str | None = None
    created_at: datetime


class ExceptionDecisionBody(BaseModel):
    approve: bool
    comment: str | None = None


class AdvanceRequestIn(BaseModel):
    amount: Decimal = Field(..., gt=Decimal("0"))
    purpose: str | None = None


class AdvanceRequestOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    employee_user_id: int
    amount: Decimal
    purpose: str | None
    status: str
    created_at: datetime


class WorkflowConfigOut(BaseModel):
    config: dict


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
