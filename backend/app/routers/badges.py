"""Badges with a barcode (new-features plan, part 2): print and reissue.

Only the head nurse. The barcode on the badge holds only the badge number, never
the PIN: a photo of the barcode is not enough to log in. Reissuing gives a new
number and the old one stops working at once (db/07_badges.sql).
"""

from fastapi import APIRouter, Depends, HTTPException, status
from psycopg import Connection, errors
from pydantic import BaseModel

from app.auth import Role, User, require_roles, role_db

router = APIRouter(prefix="/api/badges", tags=["badges"])

head_nurse_user = require_roles(Role.HEAD_NURSE)
head_nurse_db = role_db(Role.HEAD_NURSE)


class Badge(BaseModel):
    person_id: str
    full_name: str
    role: str
    badge_id: str


def list_badges(conn: Connection) -> list[Badge]:
    rows = conn.execute('SELECT * FROM fn_ListStaffBadges()').fetchall()
    return [Badge(person_id=r[0], full_name=r[1], role=r[2], badge_id=r[3]) for r in rows]


@router.get("")
def badges(conn: Connection = Depends(head_nurse_db)) -> list[Badge]:
    """Everyone who can log in, with the number to print on the badge."""
    return list_badges(conn)


@router.post("/{person_id}/reissue")
def reissue(
    person_id: str,
    user: User = Depends(head_nurse_user),
    conn: Connection = Depends(head_nurse_db),
) -> Badge:
    """New badge number for the person; the old badge no longer logs in."""
    try:
        conn.execute("SELECT fn_ReissueBadge(%s, %s)", (person_id, user.account_id))
    except errors.NoDataFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Сотрудник {person_id} не найден") from None
    return next(b for b in list_badges(conn) if b.person_id == person_id)
