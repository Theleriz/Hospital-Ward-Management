"""Login with badge + PIN, the session user and role checks.

This is the primary access-control layer; the database re-checks every request
through the user's database role (decisions.md, record 5).
"""

from dataclasses import dataclass
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
    DOCTOR = "Doctor"


# Database role the backend switches to for each user role (db/03_security.sql)
DB_ROLES: dict[Role, str] = {
    Role.ADMISSIONS: "medbase_admissions",
    Role.PUBLIC_STAFF: "medbase_public_staff",
    Role.NURSE: "medbase_nurse",
    # A nurse plus the report and the alert journal (UC-8)
    Role.HEAD_NURSE: "medbase_head_nurse",
    Role.DOCTOR: "medbase_doctor",
}


class User(BaseModel):
    account_id: str
    full_name: str
    role: Role


SESSION_KEY = "user"


@dataclass(frozen=True)
class LoginResult:
    user: User | None
    retry_after: int = 0


def authenticate(conn: Connection, badge_id: str, pin: str) -> LoginResult:
    """Atomic DB throttle and bcrypt check. The caller commits before HTTP errors."""
    row = conn.execute(
        'SELECT "Outcome", "RetryAfter", "AccountID", "FullName", "Role" '
        'FROM fn_LoginStaff(%s, %s, %s, %s)',
        (badge_id, pin, settings.login_max_failures, settings.login_lockout_seconds),
    ).fetchone()
    if row and row[0] == 'OK':
        return LoginResult(User(account_id=row[2], full_name=row[3], role=Role(row[4])))
    if row and row[0] == 'LOCKED':
        return LoginResult(None, retry_after=row[1])
    if row and row[0] == 'INVALID':
        return LoginResult(None)
    raise RuntimeError('Unexpected database login result')


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


def role_db(*roles: Role) -> Callable[..., Iterator[Connection]]:
    """Dependency: role check in the backend, then a connection as the user's database role."""

    def dependency(request: Request, user: User = Depends(require_roles(*roles))) -> Iterator[Connection]:
        with role_connection(request.app.state.pool, DB_ROLES[user.role]) as conn:
            yield conn

    return dependency
