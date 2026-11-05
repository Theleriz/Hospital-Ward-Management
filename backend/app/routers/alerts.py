"""Nurse workstation (UC-5, UC-6): alerts of my wards, acknowledgement, my status.

Nurses and head nurses only. The backend decides who may acknowledge what;
sp_AcknowledgeAlert re-checks it in the database (decisions.md, record 5).
"""

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from psycopg import Connection
from pydantic import BaseModel

from app.auth import Role, User, require_roles, role_db
from app.db_errors import database_rules

router = APIRouter(prefix="/api", tags=["alerts"])

NURSE_ROLES = (Role.NURSE, Role.HEAD_NURSE)
nurse_user = require_roles(*NURSE_ROLES)
nurse_db = role_db(*NURSE_ROLES)

NurseStatus = Literal["Available", "Busy", "OffShift"]


class Alert(BaseModel):
    alert_id: str
    ward_id: int
    ward_name: str
    patient_name: str | None
    source: Literal["MONITOR", "CALL_BUTTON"]
    priority: Literal["LOW", "HIGH", "CRITICAL"]
    description: str | None
    status: Literal["PENDING", "ESCALATED", "ACKNOWLEDGED"]
    assigned_nurse_id: str | None
    assigned_nurse_name: str | None
    escalated_to_id: str | None
    escalated_to_name: str | None
    acknowledged_by_id: str | None
    acknowledged_by_name: str | None
    created_at: datetime
    escalated_at: datetime | None
    acknowledged_at: datetime | None
    age_seconds: int
    # Filled for the signed-in nurse
    mine: bool
    can_acknowledge: bool


class AlertBoard(BaseModel):
    open: list[Alert]
    # Acknowledged during the last hour, newest first, with the response time
    recent: list[Alert]


class Ward(BaseModel):
    ward_id: int
    ward_name: str
    is_primary: bool


class Nurse(BaseModel):
    nurse_id: str
    full_name: str
    role: Role
    status: NurseStatus
    wards: list[Ward]


class StatusChange(BaseModel):
    status: NurseStatus


# %(me)s = the signed-in nurse; "InMyWard" = she or he works in the alert's ward
ALERT_SQL = """
    SELECT a."AlertID", a."WardID", w."WardName", p."FullName", a."Source", a."Priority",
           a."Description", a."Status",
           a."AssignedNurseID", na."FullName", a."EscalatedToNurseID", ne."FullName",
           a."AcknowledgedByNurseID", nk."FullName",
           a."CreatedAt", a."EscalatedAt", a."AcknowledgedAt",
           EXTRACT(EPOCH FROM CURRENT_TIMESTAMP - a."CreatedAt")::INT,
           EXISTS (SELECT 1 FROM "NurseAssignment" x
                   WHERE x."NurseID" = %(me)s AND x."WardID" = a."WardID") AS "InMyWard"
    FROM "WardAlert" a
    JOIN "Ward" w ON w."WardID" = a."WardID"
    LEFT JOIN "Patient" p ON p."PatientID" = a."PatientID"
    LEFT JOIN "Nurse" na ON na."NurseID" = a."AssignedNurseID"
    LEFT JOIN "Nurse" ne ON ne."NurseID" = a."EscalatedToNurseID"
    LEFT JOIN "Nurse" nk ON nk."NurseID" = a."AcknowledgedByNurseID"
"""

# A nurse sees the alerts of her or his wards and those assigned or escalated to her or him;
# a head nurse sees every alert of the department
MINE_SQL = """
    (a."AssignedNurseID" = %(me)s OR a."EscalatedToNurseID" = %(me)s
     OR EXISTS (SELECT 1 FROM "NurseAssignment" x WHERE x."NurseID" = %(me)s AND x."WardID" = a."WardID"))
"""

PRIORITY_ORDER = """CASE a."Priority" WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 ELSE 3 END"""


def nurse_status(conn: Connection, nurse_id: str) -> str:
    row = conn.execute('SELECT "Status" FROM "Nurse" WHERE "NurseID" = %s', (nurse_id,)).fetchone()
    return row[0] if row else "OffShift"


def alert_from_row(row, me: str, on_shift: bool) -> Alert:
    mine = me in (row[8], row[10]) or row[18]
    return Alert(
        alert_id=row[0], ward_id=row[1], ward_name=row[2], patient_name=row[3], source=row[4],
        priority=row[5], description=row[6], status=row[7],
        assigned_nurse_id=row[8], assigned_nurse_name=row[9],
        escalated_to_id=row[10], escalated_to_name=row[11],
        acknowledged_by_id=row[12], acknowledged_by_name=row[13],
        created_at=row[14], escalated_at=row[15], acknowledged_at=row[16], age_seconds=row[17],
        mine=mine,
        # Same rule as sp_AcknowledgeAlert
        can_acknowledge=row[7] != "ACKNOWLEDGED" and on_shift and mine,
    )


def get_alert(conn: Connection, alert_id: str, me: str) -> Alert | None:
    row = conn.execute(ALERT_SQL + ' WHERE a."AlertID" = %(id)s', {"me": me, "id": alert_id}).fetchone()
    return alert_from_row(row, me, nurse_status(conn, me) != "OffShift") if row else None


def get_nurse(conn: Connection, nurse_id: str) -> Nurse:
    row = conn.execute(
        'SELECT "NurseID", "FullName", "Role", "Status" FROM "Nurse" WHERE "NurseID" = %s', (nurse_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Медсестра не найдена")
    wards = conn.execute(
        """SELECT w."WardID", w."WardName", x."IsPrimary"
           FROM "NurseAssignment" x JOIN "Ward" w ON w."WardID" = x."WardID"
           WHERE x."NurseID" = %s ORDER BY w."WardID" """,
        (nurse_id,),
    ).fetchall()
    return Nurse(
        nurse_id=row[0], full_name=row[1], role=Role(row[2]), status=row[3],
        wards=[Ward(ward_id=w[0], ward_name=w[1], is_primary=w[2]) for w in wards],
    )


@router.get("/alerts")
def list_alerts(user: User = Depends(nurse_user), conn: Connection = Depends(nurse_db)) -> AlertBoard:
    me = user.account_id
    on_shift = nurse_status(conn, me) != "OffShift"
    scope = "TRUE" if user.role == Role.HEAD_NURSE else MINE_SQL
    params = {"me": me}

    open_rows = conn.execute(
        ALERT_SQL + f""" WHERE a."Status" <> 'ACKNOWLEDGED' AND {scope}
                         ORDER BY {PRIORITY_ORDER}, a."CreatedAt" """,
        params,
    ).fetchall()
    recent_rows = conn.execute(
        ALERT_SQL + f""" WHERE a."Status" = 'ACKNOWLEDGED' AND {scope}
                           AND a."AcknowledgedAt" > CURRENT_TIMESTAMP - INTERVAL '1 hour'
                         ORDER BY a."AcknowledgedAt" DESC LIMIT 10""",
        params,
    ).fetchall()
    return AlertBoard(
        open=[alert_from_row(r, me, on_shift) for r in open_rows],
        recent=[alert_from_row(r, me, on_shift) for r in recent_rows],
    )


@router.post("/alerts/{alert_id}/acknowledge")
def acknowledge(alert_id: str, user: User = Depends(nurse_user), conn: Connection = Depends(nurse_db)) -> Alert:
    me = user.account_id
    alert = get_alert(conn, alert_id, me)
    if alert is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Оповещение {alert_id} не найдено")
    if alert.status == "ACKNOWLEDGED":
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"Оповещение уже подтвердил(а) {alert.acknowledged_by_name}"
        )
    if nurse_status(conn, me) == "OffShift":
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Вы не на смене: смените статус, чтобы подтверждать оповещения"
        )
    if not alert.mine:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Это оповещение не вашей палаты")

    with database_rules():
        conn.execute("CALL sp_AcknowledgeAlert(%s, %s)", (alert_id, me))

    return get_alert(conn, alert_id, me)


@router.get("/nurses/me")
def me(user: User = Depends(nurse_user), conn: Connection = Depends(nurse_db)) -> Nurse:
    return get_nurse(conn, user.account_id)


@router.put("/nurses/me/status")
def set_status(
    body: StatusChange, user: User = Depends(nurse_user), conn: Connection = Depends(nurse_db)
) -> Nurse:
    with database_rules():
        conn.execute("CALL sp_SetNurseStatus(%s, %s)", (user.account_id, body.status))
    return get_nurse(conn, user.account_id)
