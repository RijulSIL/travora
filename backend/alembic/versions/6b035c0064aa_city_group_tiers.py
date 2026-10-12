"""city_group_tiers — replaces the fixed CityGroupType enum with an admin-managed list

A/B/C used to be a hard-coded Python enum backing a native MySQL ENUM column on three tables.
This makes the set of tiers itself admin-configurable (add as many as you want), the same way
ImpactLevel already is: a real table with a `code`, deprecate-only soft-delete, and no change to
how the three referencing columns store their value (still a plain string — see CityGroupTier's
docstring in app/models/policy.py for why that stays a string instead of becoming a foreign key).

Revision ID: 6b035c0064aa
Revises: c2393d5d1c3b
Create Date: 2026-10-08
"""

import sqlalchemy as sa

from alembic import op

revision = "6b035c0064aa"
down_revision = "c2393d5d1c3b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "city_group_tiers",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code", sa.String(length=32), nullable=False),
        sa.Column("display_name", sa.String(length=128), nullable=False),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_deprecated", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.UniqueConstraint("code", name="uq_city_group_tiers_code"),
    )

    # Seed rows for the 3 codes that already exist as enum values in live data — C keeps the
    # is_default flag the old hardcoded `resolve_city_group` fallback ("default to group C") used
    # to have, so behavior is identical immediately after this migration runs.
    op.execute(
        """
        INSERT INTO city_group_tiers (code, display_name, is_default, is_deprecated) VALUES
        ('A', 'Group A', FALSE, FALSE),
        ('B', 'Group B', FALSE, FALSE),
        ('C', 'Group C', TRUE, FALSE)
        """
    )

    # MySQL converts ENUM -> VARCHAR in place, preserving every existing stored value exactly
    # (the enum's members already *are* the strings 'A'/'B'/'C') — no separate backfill needed.
    op.alter_column(
        "city_groups", "group_type", existing_type=sa.Enum("A", "B", "C", name="citygrouptype"),
        type_=sa.String(length=32), existing_nullable=False,
    )
    op.alter_column(
        "expense_limits", "city_group", existing_type=sa.Enum("A", "B", "C", name="expensecitygrouptype"),
        type_=sa.String(length=32), existing_nullable=False,
    )
    op.alter_column(
        "claim_drafts", "destination_city_group", existing_type=sa.Enum("A", "B", "C", name="citygrouptype"),
        type_=sa.String(length=32), existing_nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        "claim_drafts", "destination_city_group", existing_type=sa.String(length=32),
        type_=sa.Enum("A", "B", "C", name="citygrouptype"), existing_nullable=True,
    )
    op.alter_column(
        "expense_limits", "city_group", existing_type=sa.String(length=32),
        type_=sa.Enum("A", "B", "C", name="expensecitygrouptype"), existing_nullable=False,
    )
    op.alter_column(
        "city_groups", "group_type", existing_type=sa.String(length=32),
        type_=sa.Enum("A", "B", "C", name="citygrouptype"), existing_nullable=False,
    )
    op.drop_table("city_group_tiers")
