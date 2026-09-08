import asyncio
import logging

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1 import api_router
from app.api.v1.health import router as health_router
from app.core.admin_bootstrap import ensure_admin_user
from app.core.config import settings
from app.core.database import engine
from app.core.db_bootstrap import (
    ensure_database_exists,
    run_migrations_to_head,
    run_seed,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Travora API", version="0.1.0")



app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    _request: Request, exc: RequestValidationError
) -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": jsonable_encoder(exc.errors())})


@app.exception_handler(Exception)
async def unhandled_exception_handler(_request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled API error", exc_info=exc)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


async def _run_monitors():
    from app.core.database import AsyncSessionLocal
    from app.services.workflow_service import process_auto_approvals
    from app.workers.advance_monitor import monitor_advances
    from app.workers.sla_monitor import monitor_slas
    
    async def run_hourly():
        while True:
            try:
                async with AsyncSessionLocal() as db:
                    await monitor_slas(db)
                    await monitor_advances(db)
            except Exception as e:
                logger.error(f"Error in hourly background monitors: {e}")
            await asyncio.sleep(3600)  # Run every hour
            
    async def run_frequent():
        while True:
            try:
                async with AsyncSessionLocal() as db:
                    await process_auto_approvals(db)
            except Exception as e:
                logger.error(f"Error in frequent background monitors: {e}")
            await asyncio.sleep(10)  # Run every 10 seconds
            
    asyncio.create_task(run_hourly())
    asyncio.create_task(run_frequent())

@app.on_event("startup")
async def on_startup() -> None:
    await ensure_database_exists()
    await run_migrations_to_head()
    await run_seed()
    await ensure_admin_user()
    import asyncio
    asyncio.create_task(_run_monitors())


@app.on_event("shutdown")
async def on_shutdown() -> None:
    # Close pool before the event loop stops (avoids aiomysql "Event loop is closed" on --reload).
    await engine.dispose()


app.include_router(health_router)
app.include_router(api_router, prefix=settings.api_v1_prefix)
