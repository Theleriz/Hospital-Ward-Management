"""PostgreSQL connection pool shared by all requests."""

from psycopg_pool import ConnectionPool

from app.config import settings


def create_pool() -> ConnectionPool:
    """New pool, opened and closed by the application lifespan (app.main).

    A closed pool cannot be reopened, so every application start gets its own.
    """
    return ConnectionPool(
        settings.database_url,
        min_size=settings.db_pool_min_size,
        max_size=settings.db_pool_max_size,
        open=False,
    )
