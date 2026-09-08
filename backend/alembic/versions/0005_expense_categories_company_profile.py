"""expense categories and company profile

Revision ID: 0005_expense_categories_company_profile
Revises: 0004_auth
Create Date: 2026-04-27
"""

import sqlalchemy as sa
from alembic import op

revision = "0005_expense_categories_company_profile"
down_revision = "0004_auth"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("expense_categories"):
        op.create_table(
            "expense_categories",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("name", sa.String(length=128), nullable=False),
            sa.Column("parent_category_id", sa.Integer(), nullable=True),
            sa.Column("bill_mandatory", sa.Boolean(), nullable=False, default=False),
            sa.Column("gst_invoice_required", sa.Boolean(), nullable=False, default=False),
            sa.Column("blacklisted_items", sa.JSON(), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False, default=True),
            sa.Column("policy_version_id", sa.Integer(), sa.ForeignKey("policy_versions.id"), nullable=False),
            sa.ForeignKeyConstraint(["parent_category_id"], ["expense_categories.id"]),
        )

    expense_indexes = {idx["name"] for idx in inspector.get_indexes("expense_categories")}
    if "ix_expense_categories_parent_category_id" not in expense_indexes:
        op.create_index(
            "ix_expense_categories_parent_category_id",
            "expense_categories",
            ["parent_category_id"],
        )

    if not inspector.has_table("company_profile"):
        op.create_table(
            "company_profile",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("company_name", sa.String(length=255), nullable=False),
            sa.Column("gstins", sa.JSON(), nullable=True),
            sa.Column("office_locations", sa.JSON(), nullable=True),
            sa.Column("bank_details", sa.Text(), nullable=True),
        )

    if bind.scalar(sa.text("SELECT COUNT(*) FROM expense_categories")):
        return

    category_table = sa.table(
        "expense_categories",
        sa.column("id", sa.Integer()),
        sa.column("name", sa.String()),
        sa.column("parent_category_id", sa.Integer()),
        sa.column("bill_mandatory", sa.Boolean()),
        sa.column("gst_invoice_required", sa.Boolean()),
        sa.column("blacklisted_items", sa.JSON()),
        sa.column("is_active", sa.Boolean()),
        sa.column("policy_version_id", sa.Integer()),
    )
    rows = [
        (1, "Air Travel", None, True, True, ["Business Class", "First Class"]),
        (2, "Train Travel", None, True, False, []),
        (3, "Bus Travel", None, True, False, []),
        (4, "Local Conveyance", None, False, False, []),
        (5, "Cab/Taxi", 4, True, True, []),
        (6, "Uber", 4, True, True, []),
        (7, "Auto", 4, True, False, []),
        (8, "Metro", 4, True, False, []),
        (9, "Personal Vehicle", 4, False, False, []),
        (10, "Hotel/Accommodation", None, True, True, []),
        (11, "Food & Meals", None, True, False, ["Alcohol", "Cigarettes"]),
        (12, "Breakfast", 11, True, False, ["Alcohol", "Cigarettes"]),
        (13, "Lunch", 11, True, False, ["Alcohol", "Cigarettes"]),
        (14, "Dinner", 11, True, False, ["Alcohol", "Cigarettes"]),
        (15, "Incidental Expenses", None, False, False, []),
        (16, "Communication", None, True, True, []),
        (17, "Day Visit Expenses", None, False, False, []),
    ]
    op.bulk_insert(
        category_table,
        [
            {
                "id": row[0],
                "name": row[1],
                "parent_category_id": row[2],
                "bill_mandatory": row[3],
                "gst_invoice_required": row[4],
                "blacklisted_items": row[5],
                "is_active": True,
                "policy_version_id": 1,
            }
            for row in rows
        ],
    )


def downgrade() -> None:
    op.drop_table("company_profile")
    op.drop_table("expense_categories")
