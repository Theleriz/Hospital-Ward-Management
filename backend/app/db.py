"""PostgreSQL connection pool shared by all requests."""

from collections.abc import Iterator
from contextlib import contextmanager

from psycopg import Connection, sql
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


@contextmanager
def role_connection(pool: ConnectionPool, db_role: str) -> Iterator[Connection]:
    """Connection that acts as db_role for one transaction.

    The backend logs in as medbase_api, which has no data access of its own.
    SET LOCAL ROLE lasts until the transaction ends, so the connection goes back
    to the pool without the role. Commits on success, rolls back on error.
    """
    with pool.connection() as conn, conn.transaction():
        conn.execute(sql.SQL("SET LOCAL ROLE {}").format(sql.Identifier(db_role)))
        yield conn
