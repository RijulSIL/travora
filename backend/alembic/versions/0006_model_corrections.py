"""model corrections

Revision ID: 0006_model_corrections
Revises: 0005_expense_categories_company_profile
Create Date: 2026-04-27
"""

import sqlalchemy as sa
from alembic import op

revision = "0006_model_corrections"
down_revision = "0005_expense_categories_company_profile"
branch_labels = None
depends_on = None


def _columns(table_name: str) -> set[str]:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    impact_columns = _columns("impact_levels")
    if "air_class_allowed" not in impact_columns:
        airclass = sa.Enum("ECONOMY", "PREMIUM_ECONOMY", "BUSINESS", name="airclass")
        airclass.create(op.get_bind(), checkfirst=True)
        op.add_column(
            "impact_levels",
            sa.Column(
                "air_class_allowed",
                airclass,
                nullable=True,
            ),
        )

    limit_columns = _columns("expense_limits")
    with op.batch_alter_table("expense_limits") as batch_op:
        if "conveyance_cap" in limit_columns and "day_visit_cap" not in limit_columns:
            batch_op.alter_column(
                "conveyance_cap",
                new_column_name="day_visit_cap",
                existing_type=sa.Numeric(12, 2),
                existing_nullable=True,
            )
        if "conveyance_is_hard_block" in limit_columns and "day_visit_is_hard_block" not in limit_columns:
            batch_op.alter_column(
                "conveyance_is_hard_block",
                new_column_name="day_visit_is_hard_block",
                existing_type=sa.Boolean(),
                existing_nullable=False,
            )


def downgrade() -> None:
    limit_columns = _columns("expense_limits")
    with op.batch_alter_table("expense_limits") as batch_op:
        if "day_visit_cap" in limit_columns and "conveyance_cap" not in limit_columns:
            batch_op.alter_column(
                "day_visit_cap",
                new_column_name="conveyance_cap",
                existing_type=sa.Numeric(12, 2),
                existing_nullable=True,
            )
        if "day_visit_is_hard_block" in limit_columns and "conveyance_is_hard_block" not in limit_columns:
            batch_op.alter_column(
                "day_visit_is_hard_block",
                new_column_name="conveyance_is_hard_block",
                existing_type=sa.Boolean(),
                existing_nullable=False,
            )

    impact_columns = _columns("impact_levels")
    if "air_class_allowed" in impact_columns:
        op.drop_column("impact_levels", "air_class_allowed")
    sa.Enum("ECONOMY", "PREMIUM_ECONOMY", "BUSINESS", name="airclass").drop(
        op.get_bind(), checkfirst=True
    )
