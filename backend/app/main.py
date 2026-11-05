"""Hospital Ward Management System (Team MedBase): backend entry point.

Business logic, checks and access control live here (primary protection layer);
database procedures re-check the critical rules (decisions.md, record 5).
"""

import logging
from contextlib import asynccontextmanager

import psycopg
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.middleware.sessions import SessionMiddleware

from app.config import settings
from app.db import create_pool
from app.routers import admissions, auth, wards

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Don't block startup on the database: /api/health reports when it is unavailable
    app.state.pool = create_pool()
    app.state.pool.open(wait=False)
    yield
    app.state.pool.close()


app = FastAPI(
    title="Hospital Ward Management API",
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)

# Signed session cookie: the browser cannot read (httponly) or alter it
app.add_middleware(
    SessionMiddleware,
    secret_key=settings.session_secret,
    session_cookie="medbase_session",
    max_age=settings.session_max_age_seconds,
    same_site="lax",
    https_only=settings.session_https_only,
)

app.include_router(auth.router)
app.include_router(wards.router)
app.include_router(admissions.router)


@app.get("/api/health")
def health(request: Request):
    """Liveness of the backend and its database connection."""
    try:
        with request.app.state.pool.connection(timeout=2) as conn:
            conn.execute("SELECT 1")
    except (psycopg.Error, TimeoutError):
        # Connection details stay in the server log, not in the response
        logger.exception("Database health check failed")
        return JSONResponse(status_code=503, content={"status": "error", "database": "unavailable"})
    return {"status": "ok", "database": "ok"}
