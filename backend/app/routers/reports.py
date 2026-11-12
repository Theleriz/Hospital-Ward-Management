"""Head nurse report (UC-8): alert history, response times, escalations.

Head nurse only (FR-31). The backend checks the role; the database re-checks it:
the report view vw_AlertResponse and the AlertEvent journal are granted only to
medbase_head_nurse (decisions.md, record 5). Read-only: nothing here changes data.
"""

from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from psycopg import Connection
from pydantic import BaseModel

from app.auth import Role, role_db

router = APIRouter(prefix="/api/reports", tags=["reports"])

head_nurse_db = role_db(Role.HEAD_NURSE)

# Response time a nurse should meet: after 30 s HIGH/CRITICAL alerts are escalated (FR-24)
TARGET_SECONDS = 30
HISTORY_LIMIT = 500

Priority = Literal["LOW", "HIGH", "CRITICAL"]


class Summary(BaseModel):
    total: int
    acknowledged: int
    open: int
    escalated: int
    # Over acknowledged alerts only; None when nothing was acknowledged
    avg_response_seconds: float | None
    median_response_seconds: float | None
    max_response_seconds: float | None
    within_target: int


class PriorityRow(BaseModel):
    priority: Priority
    total: int
    acknowledged: int
    escalated: int
    avg_response_seconds: float | None


class NurseRow(BaseModel):
    nurse_id: str
    full_name: str
    # Alerts first sent to the nurse
    assigned: int
    acknowledged: int
    avg_response_seconds: float | None
    # Assigned to the nurse, but escalated to someone else after 30 s
    escalated_away: int
    # Escalated to the nurse from someone else
    received_escalations: int


class HistoryAlert(BaseModel):
    alert_id: str
    ward_id: int
    ward_name: str
    source: Literal["MONITOR", "CALL_BUTTON"]
    priority: Priority
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
    response_seconds: float | None
    was_escalated: bool


class AlertReport(BaseModel):
    hours: int
    since: datetime
    generated_at: datetime
    target_seconds: int
    summary: Summary
    by_priority: list[PriorityRow]
    by_nurse: list[NurseRow]
    # Newest first, at most HISTORY_LIMIT; the summary counts every alert of the period
    alerts: list[HistoryAlert]
    alerts_truncated: bool


class AlertEvent(BaseModel):
    event_id: int
    event_type: Literal["CREATED", "ASSIGNED", "ESCALATED", "ACKNOWLEDGED"]
    nurse_id: str | None
    nurse_name: str | None
    occurred_at: datetime


def seconds(value: Decimal | float | None) -> float | None:
    return None if value is None else round(float(value), 1)


# Alerts of the period; %(hours)s comes from a validated integer
PERIOD_SQL = """
    WITH period AS (SELECT CURRENT_TIMESTAMP - make_interval(hours => %(hours)s) AS since),
    r AS (SELECT v.* FROM "vw_AlertResponse" v, period WHERE v."CreatedAt" >= period.since)
"""

SUMMARY_SQL = PERIOD_SQL + """
    SELECT COUNT(*),
           COUNT(*) FILTER (WHERE "Status" = 'ACKNOWLEDGED'),
           COUNT(*) FILTER (WHERE "Status" <> 'ACKNOWLEDGED'),
           COUNT(*) FILTER (WHERE "WasEscalated"),
           AVG("ResponseSeconds"),
           percentile_cont(0.5) WITHIN GROUP (ORDER BY "ResponseSeconds"),
           MAX("ResponseSeconds"),
           COUNT(*) FILTER (WHERE "ResponseSeconds" <= %(target)s),
           (SELECT since FROM period),
           CURRENT_TIMESTAMP
    FROM r
"""

BY_PRIORITY_SQL = PERIOD_SQL + """
    SELECT p.priority,
           COUNT(r."AlertID"),
           COUNT(r."AlertID") FILTER (WHERE r."Status" = 'ACKNOWLEDGED'),
           COUNT(r."AlertID") FILTER (WHERE r."WasEscalated"),
           AVG(r."ResponseSeconds")
    FROM (VALUES ('CRITICAL', 1), ('HIGH', 2), ('LOW', 3)) p(priority, ord)
    LEFT JOIN r ON r."Priority" = p.priority
    GROUP BY p.priority, p.ord
    ORDER BY p.ord
"""

# Every nurse who had something to do with an alert of the period
BY_NURSE_SQL = PERIOD_SQL + """
    SELECT n."NurseID", n."FullName",
           COUNT(*) FILTER (WHERE r."AssignedNurseID" = n."NurseID"),
           COUNT(*) FILTER (WHERE r."AcknowledgedByNurseID" = n."NurseID"),
           AVG(r."ResponseSeconds") FILTER (WHERE r."AcknowledgedByNurseID" = n."NurseID"),
           COUNT(*) FILTER (WHERE r."AssignedNurseID" = n."NurseID" AND r."WasEscalated"
                            AND r."EscalatedToNurseID" <> n."NurseID"),
           COUNT(*) FILTER (WHERE r."EscalatedToNurseID" = n."NurseID")
    FROM "Nurse" n
    JOIN r ON n."NurseID" IN (r."AssignedNurseID", r."EscalatedToNurseID", r."AcknowledgedByNurseID")
    GROUP BY n."NurseID", n."FullName"
    ORDER BY n."NurseID"
"""

HISTORY_SQL = PERIOD_SQL + """
    SELECT "AlertID", "WardID", "WardName", "Source", "Priority", "Description", "Status",
           "AssignedNurseID", "AssignedNurseName", "EscalatedToNurseID", "EscalatedToNurseName",
           "AcknowledgedByNurseID", "AcknowledgedByNurseName",
           "CreatedAt", "EscalatedAt", "AcknowledgedAt", "ResponseSeconds", "WasEscalated"
    FROM r
    ORDER BY "CreatedAt" DESC, "AlertID" DESC
    LIMIT %(limit)s
"""


@router.get("/alerts")
def alert_report(
    hours: Annotated[int, Query(ge=1, le=720, description="Период отчёта в часах (до 30 суток)")] = 24,
    conn: Connection = Depends(head_nurse_db),
) -> AlertReport:
    params = {"hours": hours, "target": TARGET_SECONDS, "limit": HISTORY_LIMIT + 1}

    s = conn.execute(SUMMARY_SQL, params).fetchone()
    summary = Summary(
        total=s[0], acknowledged=s[1], open=s[2], escalated=s[3],
        avg_response_seconds=seconds(s[4]), median_response_seconds=seconds(s[5]),
        max_response_seconds=seconds(s[6]), within_target=s[7],
    )
    by_priority = [
        PriorityRow(priority=r[0], total=r[1], acknowledged=r[2], escalated=r[3], avg_response_seconds=seconds(r[4]))
        for r in conn.execute(BY_PRIORITY_SQL, params).fetchall()
    ]
    by_nurse = [
        NurseRow(
            nurse_id=r[0], full_name=r[1], assigned=r[2], acknowledged=r[3],
            avg_response_seconds=seconds(r[4]), escalated_away=r[5], received_escalations=r[6],
        )
        for r in conn.execute(BY_NURSE_SQL, params).fetchall()
    ]
    rows = conn.execute(HISTORY_SQL, params).fetchall()
    alerts = [
        HistoryAlert(
            alert_id=r[0], ward_id=r[1], ward_name=r[2], source=r[3], priority=r[4], description=r[5],
            status=r[6], assigned_nurse_id=r[7], assigned_nurse_name=r[8],
            escalated_to_id=r[9], escalated_to_name=r[10], acknowledged_by_id=r[11], acknowledged_by_name=r[12],
            created_at=r[13], escalated_at=r[14], acknowledged_at=r[15],
            response_seconds=seconds(r[16]), was_escalated=r[17],
        )
        for r in rows[:HISTORY_LIMIT]
    ]
    return AlertReport(
        hours=hours, since=s[8], generated_at=s[9], target_seconds=TARGET_SECONDS,
        summary=summary, by_priority=by_priority, by_nurse=by_nurse,
        alerts=alerts, alerts_truncated=len(rows) > HISTORY_LIMIT,
    )


@router.get("/alerts/{alert_id}/events")
def alert_events(
    alert_id: Annotated[str, Path(max_length=20)],
    conn: Connection = Depends(head_nurse_db),
) -> list[AlertEvent]:
    """Journal of one alert (BR-08): created, assigned, escalated, acknowledged."""
    if conn.execute('SELECT 1 FROM "vw_AlertResponse" WHERE "AlertID" = %s', (alert_id,)).fetchone() is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Оповещение {alert_id} не найдено")
    rows = conn.execute(
        """SELECT e."EventID", e."EventType", e."NurseID", n."FullName", e."OccurredAt"
           FROM "AlertEvent" e
           LEFT JOIN "Nurse" n ON n."NurseID" = e."NurseID"
           WHERE e."AlertID" = %s
           ORDER BY e."EventID" """,
        (alert_id,),
    ).fetchall()
    return [
        AlertEvent(event_id=r[0], event_type=r[1], nurse_id=r[2], nurse_name=r[3], occurred_at=r[4])
        for r in rows
    ]
