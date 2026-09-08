from sqlalchemy import JSON, Boolean, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class ExpenseCategory(Base):
    __tablename__ = "expense_categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    parent_category_id: Mapped[int | None] = mapped_column(
        ForeignKey("expense_categories.id"), nullable=True, index=True
    )
    bill_mandatory: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    gst_invoice_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    blacklisted_items: Mapped[list | None] = mapped_column(JSON)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    policy_version_id: Mapped[int] = mapped_column(ForeignKey("policy_versions.id"), nullable=False)


class CompanyProfile(Base):
    __tablename__ = "company_profile"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_name: Mapped[str] = mapped_column(String(255), nullable=False)
    gstins: Mapped[list | None] = mapped_column(JSON)
    office_locations: Mapped[list | None] = mapped_column(JSON)
    bank_details: Mapped[str | None] = mapped_column(Text)
