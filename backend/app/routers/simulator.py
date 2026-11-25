"""Device simulator for demos (T-26): stands in for patient monitors and call buttons,
and for the badge readers at ward doors that report where a nurse is (decisions.md, record 14).

The alert is created as the alert service (medbase_alert_service), the same way a
real device integration would. The backend picks the nurse of the ward; the
procedure re-checks the choice. Turned off by MEDBASE_SIMULATOR_ENABLED=false.
"""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from psycopg import Connection
from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.auth import Role, require_roles
from app.config import settings
from app.db import role_connection
from app.db_errors import database_rules
from app.priority_rules import classify_vitals, assess_news2_vitals

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


class VitalSignsInput(BaseModel):
    spo2: float
    heart_rate: float
    systolic: float
    diastolic: float
    respiratory_rate: float
    temperature: float
    measurement_confirmed: bool = False
    patient_at_rest: bool = False
    acute_symptoms: bool = False
    # Missing mode keeps the original demo contract and its existing tests.
    mode: Literal["DEMO", "NEWS2"] = "DEMO"
    age_years: int | None = Field(default=None, ge=0, le=130)
    pregnant: bool | None = None
    consciousness: Literal["ALERT", "NEW_CONFUSION", "VOICE", "PAIN", "UNRESPONSIVE"] | None = None
    supplemental_oxygen: bool | None = None
    spo2_scale: Literal[1, 2] = 1
    scale2_confirmed: bool = False

    @model_validator(mode="before")
    @classmethod
    def validate_news2_payload(cls, data):
        if not isinstance(data, dict) or data.get("mode") != "NEWS2":
            return data
        unknown = set(data) - set(cls.model_fields)
        if unknown:
            raise ValueError("Unexpected NEWS2 fields: " + ", ".join(sorted(unknown)))
        for name in ("spo2", "heart_rate", "systolic", "diastolic", "respiratory_rate", "temperature"):
            if name in data and type(data[name]) not in (int, float):
                raise ValueError(f"{name} must be a number")
        for name in ("measurement_confirmed", "patient_at_rest", "acute_symptoms", "scale2_confirmed"):
            if name in data and type(data[name]) is not bool:
                raise ValueError(f"{name} must be boolean")
        for name in ("pregnant", "supplemental_oxygen"):
            if name in data and data[name] is not None and type(data[name]) is not bool:
                raise ValueError(f"{name} must be boolean or null")
        if data.get("age_years") is not None and type(data["age_years"]) is not int:
            raise ValueError("age_years must be an integer")
        if "spo2_scale" in data and type(data["spo2_scale"]) is not int:
            raise ValueError("spo2_scale must be integer 1 or 2")
        return data



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


# --- Door badge readers (decisions.md, record 14) -------------------------------------------

class SimulatorNurse(BaseModel):
    nurse_id: str
    full_name: str
    status: str
    current_ward_id: int | None


class BadgeScan(BaseModel):
    nurse_id: str = Field(max_length=20)
    ward_id: int


@router.get("/nurses")
def list_nurses(conn: Connection = Depends(service_db)) -> list[SimulatorNurse]:
    rows = conn.execute(
        'SELECT "NurseID", "FullName", "Status", "CurrentWardID" FROM "Nurse" ORDER BY "NurseID"'
    ).fetchall()
    return [SimulatorNurse(nurse_id=r[0], full_name=r[1], status=r[2], current_ward_id=r[3]) for r in rows]


@router.post("/badge-scan", status_code=status.HTTP_204_NO_CONTENT)
def badge_scan(body: BadgeScan, conn: Connection = Depends(service_db)) -> None:
    """The reader at the door of `ward_id` read the badge of `nurse_id`: she or he is there now."""
    nurse = conn.execute('SELECT "Status" FROM "Nurse" WHERE "NurseID" = %s', (body.nurse_id,)).fetchone()
    if nurse is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Медсестра {body.nurse_id} не найдена")
    if conn.execute('SELECT 1 FROM "Ward" WHERE "WardID" = %s', (body.ward_id,)).fetchone() is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Палата {body.ward_id} не найдена")
    if nurse[0] == "OffShift":
        raise HTTPException(status.HTTP_409_CONFLICT, "Медсестра не на смене")
    with database_rules():
        conn.execute("CALL sp_SetNurseLocation(%s, %s)", (body.nurse_id, body.ward_id))


@router.post("/assess-vitals")
def assess_vitals(body: VitalSignsInput):
    """Evaluate adult demo measurements without creating an alert."""

    try:
        if body.mode == "NEWS2":
            return assess_news2_vitals(**body.model_dump(exclude={"mode"}))
        return classify_vitals(
            spo2=body.spo2,
            heart_rate=body.heart_rate,
            systolic=body.systolic,
            diastolic=body.diastolic,
            respiratory_rate=body.respiratory_rate,
            temperature=body.temperature,
            measurement_confirmed=body.measurement_confirmed,
            patient_at_rest=body.patient_at_rest,
            acute_symptoms=body.acute_symptoms,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail=str(exc),
        ) from exc

# --- Automatic creation uses a fresh server-side NEWS2 assessment ------------

class News2AlertInput(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    ward_id: int
    patient_id: int | None = None
    vitals: VitalSignsInput


class News2AlertResponse(RaisedAlert):
    assessment: dict


@router.post("/alerts/from-vitals", status_code=status.HTTP_201_CREATED)
def raise_news2_alert(body: News2AlertInput, conn: Connection = Depends(service_db)) -> News2AlertResponse:
    """No client-supplied priority; reuse the existing creation/assignment path."""
    if body.vitals.mode != "NEWS2":
        raise HTTPException(status_code=422, detail="Automatic creation requires mode NEWS2")
    try:
        assessment = assess_news2_vitals(**body.vitals.model_dump(exclude={"mode"}))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if assessment["status"] != "CLASSIFIED":
        raise HTTPException(status_code=409, detail=assessment["reason"])

    v = body.vitals
    if assessment["classification_basis"] == "ACUTE_SYMPTOMS_OVERRIDE":
        description = "MedBase demo v1: acute symptoms override; NEWS2 not calculated; urgent staff review"
    else:
        description = (
            f"NEWS2 demo v1: score={assessment['news2_score']}; risk={assessment['news2_risk']}; "
            f"SpO2={v.spo2:g}; scale={v.spo2_scale}; O2={int(v.supplemental_oxygen)}; "
            f"C={v.consciousness}; HR={v.heart_rate:g}; RR={v.respiratory_rate:g}; "
            f"SBP={v.systolic:g}; T={v.temperature:g}"
        )
    created = raise_alert(
        DeviceAlert(ward_id=body.ward_id, patient_id=body.patient_id,
                    source="MONITOR", priority=assessment["priority"], description=description), conn)
    return News2AlertResponse(alert_id=created.alert_id, assigned_nurse_id=created.assigned_nurse_id,
                              assessment=assessment)

