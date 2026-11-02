"""travel requests — the traveller's name as per ID, ID type and an uploaded copy of the ID

Revision ID: b8e1f5a3c9d7
Revises: a5d9e3c7f1b2
Create Date: 2026-10-30
"""

import sqlalchemy as sa

from alembic import op

revision = "b8e1f5a3c9d7"
down_revision = "a5d9e3c7f1b2"
branch_labels = None
depends_on = None

_COLUMNS = (
    ("id_name", sa.String(255)),
    ("id_type", sa.String(32)),
    ("id_proof_ref", sa.String(80)),
    ("id_proof_filename", sa.String(255)),
    ("id_proof_content_type", sa.String(128)),
)


def upgrade() -> None:
    for name, type_ in _COLUMNS:
        op.add_column("travel_requests", sa.Column(name, type_, nullable=True))


def downgrade() -> None:
    for name, _type in reversed(_COLUMNS):
        op.drop_column("travel_requests", name)
