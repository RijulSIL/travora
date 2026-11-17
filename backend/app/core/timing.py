"""Logs a line when something people wait on is slow, so slowness in production shows up with real
numbers instead of guesses."""

import logging
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

logger = logging.getLogger(__name__)

SLOW_SECONDS = 1.0


@asynccontextmanager
async def log_if_slow(what: str, threshold: float = SLOW_SECONDS) -> AsyncIterator[None]:
    """`async with log_if_slow("claim 42 submission"):` — warns if the block took `threshold`
    seconds or more (whether it succeeded or failed)."""
    start = time.perf_counter()
    try:
        yield
    finally:
        took = time.perf_counter() - start
        if took >= threshold:
            logger.warning("Slow %s: %.2fs", what, took)
