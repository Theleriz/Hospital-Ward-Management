"""Ward nurse assignments (T-51): the head nurse decides who works in which ward.

Only the head nurse. Every ward has exactly one primary nurse (she gets the ward's
alerts first) and any number of additional nurses. The primary nurse can be taken
off only by naming another one. The backend checks these rules and answers in plain
words; the procedures re-check them in the database (decisions.md, record 5) and
write every change to "NurseAssignmentLog". Alerts that already exist keep their
nurse; new alerts follow the new assignment at once.
"""

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from psycopg import Connection
from pydantic import BaseModel, Field

from app.auth import Role, User, require_roles, role_db
from app.db_errors import database_rules

router = APIRouter(prefix="/api/assignments", tags=["assignments"])

head_nurse_user = require_roles(Role.HEAD_NURSE)
head_nurse_db = role_db(Role.HEAD_NURSE)

LOG_LIMIT = 200


class NurseOption(BaseModel):
    nurse_id: str
    full_name: str
    role: str
    status: str


class AssignedNurse(BaseModel):
    nurse_id: str
    full_name: str
    status: str
    is_primary: bool


class WardAssignment(BaseModel):
    ward_id: int
    ward_name: str
    primary_nurse_id: str | None
    # Primary nurse first, then additional nurses by name
    nurses: list[AssignedNurse]


class AssignmentBoard(BaseModel):
    wards: list[WardAssignment]
    nurses: list[NurseOption]


class AssignNurse(BaseModel):
    nurse_id: str = Field(min_length=1, max_length=20)
    reason: str | None = Field(default=None, max_length=200)


class LogEntry(BaseModel):
    log_id: int
    changed_at: datetime
    ward_id: int
    ward_name: str
    action: Literal["ASSIGN_PRIMARY", "ASSIGN_ADDITIONAL", "REMOVE_ADDITIONAL", "AUTO_ASSIGN_PRIMARY"]
    nurse_id: str
    nurse_name: str
    previous_primary_nurse_id: str | None
    # NULL for automatic handoffs (a primary nurse went off shift)
    changed_by_nurse_id: str | None
    changed_by_name: str | None
    reason: str | None


WARD_SQL = """
    SELECT w."WardID", w."WardName", n."NurseID", n."FullName", n."Status", x."IsPrimary"
    FROM "Ward" w
    LEFT JOIN "NurseAssignment" x ON x."WardID" = w."WardID"
    LEFT JOIN "Nurse" n ON n."NurseID" = x."NurseID"
"""
WARD_ORDER = ' ORDER BY w."WardID", x."IsPrimary" DESC, n."FullName"'

NURSES_SQL = """
    SELECT "NurseID", "FullName", "Role", "Status" FROM "Nurse" ORDER BY "FullName"
"""

LOG_SQL = """
    SELECT l."LogID", l."ChangedAt", l."WardID", w."WardName", l."Action",
           l."NurseID", n."FullName", l."PreviousPrimaryNurseID",
           l."ChangedByNurseID", c."FullName", l."Reason"
    FROM "NurseAssignmentLog" l
    JOIN "Ward" w ON w."WardID" = l."WardID"
    JOIN "Nurse" n ON n."NurseID" = l."NurseID"
    LEFT JOIN "Nurse" c ON c."NurseID" = l."ChangedByNurseID"
    WHERE %(ward)s::INT IS NULL OR l."WardID" = %(ward)s
    ORDER BY l."LogID" DESC
    LIMIT %(limit)s
"""


def wards_from_rows(rows) -> list[WardAssignment]:
    wards: dict[int, WardAssignment] = {}
    for ward_id, ward_name, nurse_id, full_name, nurse_status, is_primary in rows:
        ward = wards.setdefault(
            ward_id, WardAssignment(ward_id=ward_id, ward_name=ward_name, primary_nurse_id=None, nurses=[])
        )
        if nurse_id is None:
            continue
        ward.nurses.append(
            AssignedNurse(nurse_id=nurse_id, full_name=full_name, status=nurse_status, is_primary=is_primary)
        )
        if is_primary:
            ward.primary_nurse_id = nurse_id
    return list(wards.values())


def get_ward(conn: Connection, ward_id: int) -> WardAssignment:
    rows = conn.execute(WARD_SQL + ' WHERE w."WardID" = %s' + WARD_ORDER, (ward_id,)).fetchall()
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Палата {ward_id} не найдена")
    return wards_from_rows(rows)[0]


def get_nurse(conn: Connection, nurse_id: str) -> NurseOption:
    row = conn.execute(
        'SELECT "NurseID", "FullName", "Role", "Status" FROM "Nurse" WHERE "NurseID" = %s', (nurse_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Медсестра {nurse_id} не найдена")
    return NurseOption(nurse_id=row[0], full_name=row[1], role=row[2], status=row[3])


def nurse_on_shift(conn: Connection, nurse_id: str) -> NurseOption:
    nurse = get_nurse(conn, nurse_id)
    if nurse.status == "OffShift":
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"{nurse.full_name} сейчас не на смене, назначить её на палату нельзя"
        )
    return nurse


@router.get("")
def board(conn: Connection = Depends(head_nurse_db)) -> AssignmentBoard:
    """Nurses × wards: who is primary and who is additional in each ward."""
    wards = wards_from_rows(conn.execute(WARD_SQL + WARD_ORDER).fetchall())
    nurses = [
        NurseOption(nurse_id=r[0], full_name=r[1], role=r[2], status=r[3])
        for r in conn.execute(NURSES_SQL).fetchall()
    ]
    return AssignmentBoard(wards=wards, nurses=nurses)


@router.put("/{ward_id}/primary")
def set_primary(
    ward_id: int,
    body: AssignNurse,
    user: User = Depends(head_nurse_user),
    conn: Connection = Depends(head_nurse_db),
) -> WardAssignment:
    """Make the nurse the ward's primary nurse; the previous one stays as additional."""
    ward = get_ward(conn, ward_id)
    nurse_on_shift(conn, body.nurse_id)
    if ward.primary_nurse_id == body.nurse_id:
        return ward

    with database_rules():
        conn.execute(
            "CALL sp_AssignWardNurse(%s, %s, TRUE, %s, %s)",
            (ward_id, body.nurse_id, user.account_id, body.reason),
        )
    return get_ward(conn, ward_id)


@router.post("/{ward_id}/nurses")
def add_nurse(
    ward_id: int,
    body: AssignNurse,
    user: User = Depends(head_nurse_user),
    conn: Connection = Depends(head_nurse_db),
) -> WardAssignment:
    """Add the nurse to the ward as an additional nurse."""
    ward = get_ward(conn, ward_id)
    nurse = nurse_on_shift(conn, body.nurse_id)
    if ward.primary_nurse_id == body.nurse_id:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"{nurse.full_name} — основная медсестра палаты «{ward.ward_name}». "
            "Чтобы сделать её дополнительной, сначала назначьте другую основную",
        )
    if any(n.nurse_id == body.nurse_id for n in ward.nurses):
        return ward

    with database_rules():
        conn.execute(
            "CALL sp_AssignWardNurse(%s, %s, FALSE, %s, %s)",
            (ward_id, body.nurse_id, user.account_id, body.reason),
        )
    return get_ward(conn, ward_id)


@router.delete("/{ward_id}/nurses/{nurse_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_nurse(
    ward_id: int,
    nurse_id: str,
    reason: str | None = Query(default=None, max_length=200),
    user: User = Depends(head_nurse_user),
    conn: Connection = Depends(head_nurse_db),
) -> Response:
    """Take an additional nurse off the ward. The primary nurse is replaced, not removed."""
    ward = get_ward(conn, ward_id)
    assigned = next((n for n in ward.nurses if n.nurse_id == nurse_id), None)
    if assigned is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Медсестра {nurse_id} не работает в палате «{ward.ward_name}»")
    if assigned.is_primary:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"{assigned.full_name} — основная медсестра палаты «{ward.ward_name}». "
            "Сначала назначьте другую основную",
        )

    with database_rules():
        conn.execute(
            "CALL sp_RemoveAdditionalNurse(%s, %s, %s, %s)",
            (ward_id, nurse_id, user.account_id, reason),
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/log")
def log(
    ward_id: int | None = None,
    limit: int = Query(default=50, ge=1, le=LOG_LIMIT),
    conn: Connection = Depends(head_nurse_db),
) -> list[LogEntry]:
    """Journal of assignment changes, newest first: who, when, what changed."""
    rows = conn.execute(LOG_SQL, {"ward": ward_id, "limit": limit}).fetchall()
    return [
        LogEntry(
            log_id=r[0], changed_at=r[1], ward_id=r[2], ward_name=r[3], action=r[4],
            nurse_id=r[5], nurse_name=r[6], previous_primary_nurse_id=r[7],
            changed_by_nurse_id=r[8], changed_by_name=r[9], reason=r[10],
        )
        for r in rows
    ]
