"""Traveller profile: meal preference and ID on the user, meal + passport on travel requests

Everyone gives their meal preference (veg / non-veg) and their ID (name as per ID, which ID, a
copy) once, on a setup screen after their first sign-in; travel requests are filled in from it.
A travel request also keeps the meal preference for that trip and, optionally, the traveller's
passport number and expiry date (needed for international travel).

Revision ID: d4a8b2c6e9f1
Revises: c3f7a9d2e5b1
Create Date: 2026-11-19
"""

import sqlalchemy as sa

from alembic import op

revision = "d4a8b2c6e9f1"
down_revision = "c3f7a9d2e5b1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("meal_preference", sa.String(length=16), nullable=True))
        batch.add_column(sa.Column("id_name", sa.String(length=255), nullable=True))
        batch.add_column(sa.Column("id_type", sa.String(length=32), nullable=True))
        batch.add_column(sa.Column("id_proof_ref", sa.String(length=80), nullable=True))
        batch.add_column(sa.Column("id_proof_filename", sa.String(length=255), nullable=True))
        batch.add_column(sa.Column("id_proof_content_type", sa.String(length=128), nullable=True))
    with op.batch_alter_table("travel_requests") as batch:
        batch.add_column(sa.Column("meal_preference", sa.String(length=16), nullable=True))
        batch.add_column(sa.Column("passport_number", sa.String(length=32), nullable=True))
        batch.add_column(sa.Column("passport_expiry", sa.Date(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("travel_requests") as batch:
        batch.drop_column("passport_expiry")
        batch.drop_column("passport_number")
        batch.drop_column("meal_preference")
    with op.batch_alter_table("users") as batch:
        batch.drop_column("id_proof_content_type")
        batch.drop_column("id_proof_filename")
        batch.drop_column("id_proof_ref")
        batch.drop_column("id_type")
        batch.drop_column("id_name")
        batch.drop_column("meal_preference")
