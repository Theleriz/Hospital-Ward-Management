"""Device simulator for demos (T-26): stands in for patient monitors and call buttons.

The alert is created as the alert service (medbase_alert_service), the same way a
real device integration would. The backend picks the nurse of the ward; the
procedure re-checks the choice. Turned off by MEDBASE_SIMULATOR_ENABLED=false.
"""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from psycopg import Connection
from pydantic import BaseModel, Field

from app.auth import Role, require_roles
from app.config import settings
from app.db import role_connection
from app.db_errors import database_rules

ALERT_SERVICE_ROLE = "medbase_alert_service"


def simulator_enabled() -> None:
    if not settings.simulator_enabled:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Симулятор выключен")


router = APIRouter(
    prefix="/api/simulator",
    tags=["simulator"],
    dependencies=[Depends(simulator_enabled), Depends(require_roles(Role.NURSE, Role.HEAD_NURSE))],
)


def service_db(request: Request):
    with role_connection(request.app.state.pool, ALERT_SERVICE_ROLE) as conn:
        yield conn


class Patient(BaseModel):
    patient_id: int
    full_name: str


class SimulatorWard(BaseModel):
    ward_id: int
    ward_name: str
    patients: list[Patient]
    nurse_on_duty: str | None


class DeviceAlert(BaseModel):
    ward_id: int
    patient_id: int | None = None
    source: Literal["MONITOR", "CALL_BUTTON"]
    priority: Literal["LOW", "HIGH", "CRITICAL"]
    description: str | None = Field(default=None, max_length=200)


class RaisedAlert(BaseModel):
    alert_id: str
    assigned_nurse_id: str | None


DEFAULT_DESCRIPTIONS = {
    ("MONITOR", "CRITICAL"): "SpO2 упала до 84%",
    ("MONITOR", "HIGH"): "ЧСС 135 уд/мин",
    ("MONITOR", "LOW"): "Слабый сигнал датчика",
    ("CALL_BUTTON", "CRITICAL"): "Пациент сообщает о боли в груди",
    ("CALL_BUTTON", "HIGH"): "Пациент нажал кнопку вызова",
    ("CALL_BUTTON", "LOW"): "Пациент просит воды",
}


def nurse_on_duty(conn: Connection, ward_id: int) -> str | None:
    """The ward's nurse who gets the alert: the primary nurse if on shift, else
    another nurse of the ward on shift (Available before Busy), else nobody."""
    row = conn.execute(
        """SELECT n."NurseID"
           FROM "NurseAssignment" x JOIN "Nurse" n ON n."NurseID" = x."NurseID"
           WHERE x."WardID" = %s AND n."Status" <> 'OffShift'
           ORDER BY x."IsPrimary" DESC, n."Status" = 'Available' DESC, n."NurseID"
           LIMIT 1""",
        (ward_id,),
    ).fetchone()
    return row[0] if row else None


@router.get("/wards")
def list_wards(conn: Connection = Depends(service_db)) -> list[SimulatorWard]:
    wards = conn.execute('SELECT "WardID", "WardName" FROM "Ward" ORDER BY "WardID"').fetchall()
    patients = conn.execute(
        """SELECT a."WardID", p."PatientID", p."FullName"
           FROM "Admission" a JOIN "Patient" p ON p."PatientID" = a."PatientID"
           WHERE a."Status" = 'Active' ORDER BY p."FullName" """
    ).fetchall()
    return [
        SimulatorWard(
            ward_id=w[0],
            ward_name=w[1],
            patients=[Patient(patient_id=p[1], full_name=p[2]) for p in patients if p[0] == w[0]],
            nurse_on_duty=nurse_on_duty(conn, w[0]),
        )
        for w in wards
    ]


@router.post("/alerts", status_code=status.HTTP_201_CREATED)
def raise_alert(body: DeviceAlert, conn: Connection = Depends(service_db)) -> RaisedAlert:
    if conn.execute('SELECT 1 FROM "Ward" WHERE "WardID" = %s', (body.ward_id,)).fetchone() is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Палата {body.ward_id} не найдена")
    if body.patient_id is not None:
        in_ward = conn.execute(
            """SELECT 1 FROM "Admission"
               WHERE "PatientID" = %s AND "WardID" = %s AND "Status" = 'Active'""",
            (body.patient_id, body.ward_id),
        ).fetchone()
        if in_ward is None:
            raise HTTPException(status.HTTP_409_CONFLICT, "Этот пациент не лежит в выбранной палате")

    nurse = nurse_on_duty(conn, body.ward_id)
    description = (body.description or "").strip() or DEFAULT_DESCRIPTIONS[(body.source, body.priority)]

    with database_rules():
        row = conn.execute(
            "CALL sp_RaiseAlert(%s, %s, %s, %s, %s, %s, NULL)",
            (body.ward_id, body.patient_id, body.source, body.priority, description, nurse),
        ).fetchone()

    return RaisedAlert(alert_id=row[0], assigned_nurse_id=nurse)
