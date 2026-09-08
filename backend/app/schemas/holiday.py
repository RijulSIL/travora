from datetime import date, datetime

from pydantic import BaseModel, Field


class CompanyHolidayOut(BaseModel):
    id: int
    holiday_date: date
    name: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class CompanyHolidayCreateIn(BaseModel):
    holiday_date: date
    name: str = Field(..., min_length=1, max_length=255)


class CompanyHolidayUpdateIn(BaseModel):
    holiday_date: date | None = None
    name: str | None = Field(default=None, min_length=1, max_length=255)
