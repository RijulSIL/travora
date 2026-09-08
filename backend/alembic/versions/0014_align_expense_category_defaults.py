"""align expense category defaults with phase-1 ticket

Revision ID: 0014_align_expense_category_defaults
Revises: 0013_phase5_finance_reporting_audit
Create Date: 2026-04-27
"""

import sqlalchemy as sa
from alembic import op

revision = "0014_align_expense_category_defaults"
down_revision = "0013_phase5_finance_reporting_audit"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if not bind.scalar(sa.text("SELECT COUNT(*) FROM expense_categories")):
        return

    bind.execute(
        sa.text(
            """
            UPDATE expense_categories
            SET blacklisted_items = :blacklist
            WHERE name = 'Air Travel'
            """
        ),
        {"blacklist": '["Business Class","First Class"]'},
    )
    bind.execute(
        sa.text(
            """
            UPDATE expense_categories
            SET blacklisted_items = :blacklist
            WHERE name IN ('Food & Meals', 'Breakfast', 'Lunch', 'Dinner')
            """
        ),
        {"blacklist": '["Alcohol","Cigarettes"]'},
    )

    rename_pairs = [
        ("Own Vehicle 4W", "Personal Vehicle"),
        ("Hired Taxi", "Cab/Taxi"),
        ("Auto/Cab", "Auto"),
    ]
    for old_name, new_name in rename_pairs:
        bind.execute(
            sa.text("UPDATE expense_categories SET name = :new_name WHERE name = :old_name"),
            {"old_name": old_name, "new_name": new_name},
        )

    local_conveyance_row = bind.execute(
        sa.text(
            """
            SELECT id, policy_version_id
            FROM expense_categories
            WHERE name = 'Local Conveyance'
            LIMIT 1
            """
        )
    )
    local_conveyance = local_conveyance_row.first()
    if local_conveyance:
        local_conveyance_id = local_conveyance[0]
        policy_version_id = local_conveyance[1]
        if not bind.scalar(sa.text("SELECT COUNT(*) FROM expense_categories WHERE name = 'Uber'")):
            bind.execute(
                sa.text(
                    """
                    INSERT INTO expense_categories
                        (name, parent_category_id, bill_mandatory, gst_invoice_required, blacklisted_items, is_active, policy_version_id)
                    VALUES
                        ('Uber', :parent_id, :bill_mandatory, :gst_invoice_required, :blacklisted_items, :is_active, :policy_version_id)
                    """
                ),
                {
                    "parent_id": local_conveyance_id,
                    "bill_mandatory": True,
                    "gst_invoice_required": True,
                    "blacklisted_items": "[]",
                    "is_active": True,
                    "policy_version_id": policy_version_id,
                },
            )
        if not bind.scalar(sa.text("SELECT COUNT(*) FROM expense_categories WHERE name = 'Metro'")):
            bind.execute(
                sa.text(
                    """
                    INSERT INTO expense_categories
                        (name, parent_category_id, bill_mandatory, gst_invoice_required, blacklisted_items, is_active, policy_version_id)
                    VALUES
                        ('Metro', :parent_id, :bill_mandatory, :gst_invoice_required, :blacklisted_items, :is_active, :policy_version_id)
                    """
                ),
                {
                    "parent_id": local_conveyance_id,
                    "bill_mandatory": True,
                    "gst_invoice_required": False,
                    "blacklisted_items": "[]",
                    "is_active": True,
                    "policy_version_id": policy_version_id,
                },
            )

    bind.execute(sa.text("DELETE FROM expense_categories WHERE name = 'Team Meal'"))


def downgrade() -> None:
    pass
