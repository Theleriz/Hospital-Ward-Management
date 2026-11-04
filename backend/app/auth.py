"""Login with badge + PIN, the session user and role checks.

This is the primary access-control layer; the database re-checks every request
through the user's database role (decisions.md, record 5).
"""

import threading
import time
from collections.abc import Callable, Iterator
from enum import StrEnum

from fastapi import Depends, HTTPException, Request, status
from psycopg import Connection
from pydantic import BaseModel

from app.config import settings
from app.db import role_connection


class Role(StrEnum):
    ADMISSIONS = "Admissions"
    PUBLIC_STAFF = "PublicStaff"
    NURSE = "Nurse"
    HEAD_NURSE = "HeadNurse"


# Database role the backend switches to for each user role (db/03_security.sql)
DB_ROLES: dict[Role, str] = {
    Role.ADMISSIONS: "medbase_admissions",
    Role.PUBLIC_STAFF: "medbase_public_staff",
    Role.NURSE: "medbase_nurse",
    Role.HEAD_NURSE: "medbase_nurse",
}


class User(BaseModel):
    account_id: str
    full_name: str
    role: Role


SESSION_KEY = "user"


def authenticate(conn: Connection, badge_id: str, pin: str) -> User | None:
    """Account for the badge if the PIN is right (checked inside the database)."""
    row = conn.execute(
        'SELECT "AccountID", "FullName", "Role" FROM fn_AuthenticateStaff(%s, %s)',
        (badge_id, pin),
    ).fetchone()
    if row is None:
        return None
    return User(account_id=row[0], full_name=row[1], role=Role(row[2]))


class LoginThrottle:
    """Locks a badge for a while after too many wrong PINs.

    Kept in memory of the backend process: enough for one ward installation.
    """

    def __init__(self, max_failures: int, lockout_seconds: int):
        self.max_failures = max_failures
        self.lockout_seconds = lockout_seconds
        self._failures: dict[str, int] = {}
        self._locked_until: dict[str, float] = {}
        self._lock = threading.Lock()

    def seconds_locked(self, badge_id: str) -> int:
        with self._lock:
            remaining = self._locked_until.get(badge_id, 0) - time.monotonic()
            if remaining <= 0:
                self._locked_until.pop(badge_id, None)
                return 0
            return int(remaining) + 1

    def record_failure(self, badge_id: str) -> None:
        with self._lock:
            failures = self._failures.get(badge_id, 0) + 1
            if failures >= self.max_failures:
                self._locked_until[badge_id] = time.monotonic() + self.lockout_seconds
                failures = 0
            self._failures[badge_id] = failures

    def record_success(self, badge_id: str) -> None:
        with self._lock:
            self._failures.pop(badge_id, None)

    def reset(self) -> None:
        with self._lock:
            self._failures.clear()
            self._locked_until.clear()


login_throttle = LoginThrottle(settings.login_max_failures, settings.login_lockout_seconds)


def current_user(request: Request) -> User:
    """Signed-in user from the session cookie, or 401."""
    data = request.session.get(SESSION_KEY)
    if data is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Требуется вход")
    return User.model_validate(data)


def require_roles(*roles: Role) -> Callable[..., User]:
    """Dependency: the signed-in user must have one of the roles, otherwise 403."""

    def dependency(user: User = Depends(current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Недостаточно прав")
        return user

    return dependency


def user_db(request: Request, user: User = Depends(current_user)) -> Iterator[Connection]:
    """Database connection acting as the signed-in user's database role."""
    with role_connection(request.app.state.pool, DB_ROLES[user.role]) as conn:
        yield conn
