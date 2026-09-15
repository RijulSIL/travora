from decimal import Decimal

from pydantic import BaseModel, Field


class BudgetConfigOut(BaseModel):
    enabled: bool


class BudgetConfigIn(BaseModel):
    enabled: bool


class DepartmentBudgetIn(BaseModel):
    department: str = Field(min_length=1, max_length=255)
    monthly_amount: Decimal = Field(ge=0)


class DepartmentBudgetOut(BaseModel):
    id: int
    department: str
    monthly_amount: Decimal


class ManagerBudgetIn(BaseModel):
    manager_user_id: int
    monthly_amount: Decimal = Field(ge=0)


class ManagerBudgetOut(BaseModel):
    id: int
    manager_user_id: int
    manager_name: str | None = None
    manager_email: str | None = None
    department: str | None = None
    monthly_amount: Decimal


class ManagerOptionOut(BaseModel):
    user_id: int
    full_name: str | None
    email: str
    department: str | None = None


class BudgetOptionsOut(BaseModel):
    departments: list[str]
    managers: list[ManagerOptionOut]
