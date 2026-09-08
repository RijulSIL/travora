import asyncio
import logging
from pathlib import Path

import aiomysql
from alembic import command
from alembic.config import Config

from app.core.config import settings

logger = logging.getLogger(__name__)


async def ensure_database_exists() -> None:
    if not settings.db_create_if_missing:
        return

    try:
        conn = await aiomysql.connect(
            host=settings.db_host,
            port=settings.db_port,
            user=settings.db_user,
            password=settings.db_password,
            autocommit=True,
        )
    except Exception:
        logger.exception(
            "Failed to connect to MySQL at %s:%s as %s",
            settings.db_host,
            settings.db_port,
            settings.db_user,
        )
        raise

    try:
        async with conn.cursor() as cursor:
            await cursor.execute(
                f"CREATE DATABASE IF NOT EXISTS `{settings.db_name}` "
                "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
            )
            logger.info("Ensured database `%s` exists", settings.db_name)
    finally:
        conn.close()


async def _ensure_alembic_version_column_size() -> None:
    conn = await aiomysql.connect(
        host=settings.db_host,
        port=settings.db_port,
        user=settings.db_user,
        password=settings.db_password,
        db=settings.db_name,
        autocommit=True,
    )
    try:
        async with conn.cursor() as cursor:
            await cursor.execute(
                """
                SELECT CHARACTER_MAXIMUM_LENGTH
                FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = %s
                  AND TABLE_NAME = 'alembic_version'
                  AND COLUMN_NAME = 'version_num'
                """,
                (settings.db_name,),
            )
            row = await cursor.fetchone()
            if row and row[0] is not None and int(row[0]) < 64:
                await cursor.execute(
                    "ALTER TABLE alembic_version MODIFY COLUMN version_num VARCHAR(255) NOT NULL"
                )
                logger.info("Expanded alembic_version.version_num to VARCHAR(255)")
    finally:
        conn.close()


def _alembic_config() -> Config:
    backend_root = Path(__file__).resolve().parents[2]
    cfg = Config(str(backend_root / "alembic.ini"))
    cfg.set_main_option("script_location", str(backend_root / "alembic"))
    # ConfigParser treats '%' as interpolation markers, so encoded passwords
    # like '%40' must be escaped before injecting into alembic config.
    cfg.set_main_option("sqlalchemy.url", settings.database_url.replace("%", "%%"))
    return cfg


def _run_alembic_upgrade_sync() -> None:
    cfg = _alembic_config()
    command.upgrade(cfg, "head")


async def run_migrations_to_head() -> None:
    await _ensure_alembic_version_column_size()
    # Alembic's online mode internally calls asyncio.run(...), which fails if a
    # loop is already running. Offload the sync alembic command to a worker
    # thread so it can spin up its own event loop.
    await asyncio.to_thread(_run_alembic_upgrade_sync)
    logger.info("Applied alembic migrations up to head")


async def run_seed() -> None:
    from app.core.seed import seed

    await seed()
    logger.info("Reference data seed step completed")
