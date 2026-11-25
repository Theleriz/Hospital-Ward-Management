"""Ward map (decisions.md, record 14): floors, wards, where the nurses are right now,
their status and the open alerts of each ward.

For nurses and the head nurse: it shows whom the escalation will call and why.
No patient data: only bed counts and alert priorities.
"""

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends
from psycopg import Connection
from pydantic import BaseModel

from app.auth import Role, role_db
from app.escalation import LOCATION_FRESH_MINUTES

router = APIRouter(prefix="/api", tags=["map"])

map_db = role_db(Role.NURSE, Role.HEAD_NURSE)

NurseStatus = Literal["Available", "Busy", "OffShift"]


class MapNurse(BaseModel):
    nurse_id: str
    full_name: str
    role: Role
    status: NurseStatus
    # Open HIGH/CRITICAL alerts she or he is answering (decisions.md, record 13)
    open_calls: int
    location_at: datetime | None


class MapAlert(BaseModel):
    alert_id: str
    priority: Literal["LOW", "HIGH", "CRITICAL"]
    status: Literal["PENDING", "ESCALATED"]
    age_seconds: int
    assigned_nurse_name: str | None
    escalated_to_id: str | None
    escalated_to_name: str | None


class MapWard(BaseModel):
    ward_id: int
    ward_name: str
    ward_type: str
    capacity: int
    occupied: int
    nurses_here: list[MapNurse]
    alerts: list[MapAlert]


class MapFloor(BaseModel):
    floor: int
    wards: list[MapWard]


class WardMap(BaseModel):
    floors: list[MapFloor]
    # On shift, but no door reader saw them recently
    location_unknown: list[MapNurse]
    off_shift: list[MapNurse]
    location_fresh_minutes: int


NURSES_SQL = """
    SELECT n."NurseID", n."FullName", n."Role", n."Status",
           (SELECT COUNT(*) FROM "WardAlert" o
            WHERE o."Priority" IN ('HIGH', 'CRITICAL')
              AND ((o."Status" = 'PENDING' AND o."AssignedNurseID" = n."NurseID")
                   OR (o."Status" = 'ESCALATED' AND o."EscalatedToNurseID" = n."NurseID"))),
           n."LocationAt",
           CASE WHEN n."LocationAt" > CURRENT_TIMESTAMP - make_interval(mins => %(fresh)s)
                THEN n."CurrentWardID" END
    FROM "Nurse" n
    ORDER BY n."FullName"
"""

ALERTS_SQL = """
    SELECT a."AlertID", a."WardID", a."Priority", a."Status",
           EXTRACT(EPOCH FROM CURRENT_TIMESTAMP - a."CreatedAt")::INT,
           na."FullName", a."EscalatedToNurseID", ne."FullName"
    FROM "WardAlert" a
    LEFT JOIN "Nurse" na ON na."NurseID" = a."AssignedNurseID"
    LEFT JOIN "Nurse" ne ON ne."NurseID" = a."EscalatedToNurseID"
    WHERE a."Status" <> 'ACKNOWLEDGED'
    ORDER BY CASE a."Priority" WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 ELSE 3 END, a."CreatedAt"
"""


@router.get("/map")
def ward_map(conn: Connection = Depends(map_db)) -> WardMap:
    wards = conn.execute(
        """SELECT "WardID", "WardName", "FloorNum", "WardType", "Capacity", "CurrentOccupancy"
           FROM "vw_WardCapacity" ORDER BY "FloorNum", "WardID" """
    ).fetchall()
    nurses = conn.execute(NURSES_SQL, {"fresh": LOCATION_FRESH_MINUTES}).fetchall()
    alerts = conn.execute(ALERTS_SQL).fetchall()

    def nurse(r) -> MapNurse:
        return MapNurse(nurse_id=r[0], full_name=r[1], role=Role(r[2]), status=r[3],
                        open_calls=r[4], location_at=r[5])

    floors: dict[int, list[MapWard]] = {}
    for w in wards:
        floors.setdefault(w[2], []).append(MapWard(
            ward_id=w[0], ward_name=w[1], ward_type=w[3], capacity=w[4], occupied=w[5],
            nurses_here=[nurse(n) for n in nurses if n[3] != "OffShift" and n[6] == w[0]],
            alerts=[
                MapAlert(alert_id=a[0], priority=a[2], status=a[3], age_seconds=a[4],
                         assigned_nurse_name=a[5], escalated_to_id=a[6], escalated_to_name=a[7])
                for a in alerts if a[1] == w[0]
            ],
        ))

    return WardMap(
        floors=[MapFloor(floor=f, wards=ws) for f, ws in sorted(floors.items())],
        location_unknown=[nurse(n) for n in nurses if n[3] != "OffShift" and n[6] is None],
        off_shift=[nurse(n) for n in nurses if n[3] == "OffShift"],
        location_fresh_minutes=LOCATION_FRESH_MINUTES,
    )
