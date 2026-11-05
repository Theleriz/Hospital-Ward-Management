"""Admissions desk (UC-1 to UC-3): admit, transfer, discharge.

Only admissions staff. The backend checks the rules and answers in plain words;
the procedures re-check them in the database (decisions.md, record 5).
"""

from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response, status
from psycopg import Connection
from pydantic import BaseModel, Field

from app.auth import Role, role_db
from app.db_errors import database_rules
from app.routers.wards import WardCapacity, get_ward

router = APIRouter(prefix="/api/admissions", tags=["admissions"])

admissions_db = role_db(Role.ADMISSIONS)


class ActiveAdmission(BaseModel):
    admission_id: int
    patient_id: int
    full_name: str
    dob: date
    phone: str | None
    gender: str | None
    ward_id: int
    ward_name: str
    admit_date: date


class NewAdmission(BaseModel):
    full_name: str = Field(min_length=2, max_length=100)
    dob: date
    # The phone identifies a returning patient (sp_RegisterAndAdmitPatient)
    phone: str = Field(pattern=r"^\+?\d{10,15}$")
    gender: Literal["Male", "Female"] | None = None
    ward_id: int


class Transfer(BaseModel):
    ward_id: int


ACTIVE_SQL = """
    SELECT a."AdmissionID", p."PatientID", p."FullName", p."DOB", p."Phone", p."Gender",
           w."WardID", w."WardName", a."AdmitDate"
    FROM "Admission" a
    JOIN "Patient" p ON p."PatientID" = a."PatientID"
    JOIN "Ward" w ON w."WardID" = a."WardID"
    WHERE a."Status" = 'Active'
"""


def admission_from_row(row) -> ActiveAdmission:
    return ActiveAdmission(
        admission_id=row[0], patient_id=row[1], full_name=row[2], dob=row[3], phone=row[4],
        gender=row[5], ward_id=row[6], ward_name=row[7], admit_date=row[8],
    )


def active_admission(conn: Connection, patient_id: int) -> ActiveAdmission | None:
    row = conn.execute(ACTIVE_SQL + ' AND p."PatientID" = %s', (patient_id,)).fetchone()
    return admission_from_row(row) if row else None


def ward_with_free_bed(conn: Connection, ward_id: int) -> WardCapacity:
    ward = get_ward(conn, ward_id)
    if ward is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Палата {ward_id} не найдена")
    if ward.available <= 0:
        raise HTTPException(status.HTTP_409_CONFLICT, f"В палате «{ward.ward_name}» нет свободных мест")
    return ward


@router.get("/active")
def list_active(conn: Connection = Depends(admissions_db)) -> list[ActiveAdmission]:
    rows = conn.execute(ACTIVE_SQL + ' ORDER BY w."WardID", p."FullName"').fetchall()
    return [admission_from_row(row) for row in rows]


@router.post("", status_code=status.HTTP_201_CREATED)
def admit(body: NewAdmission, conn: Connection = Depends(admissions_db)) -> ActiveAdmission:
    """Register the patient (or find them by phone) and admit to the ward (UC-1)."""
    if not date(1900, 1, 1) <= body.dob <= date.today():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Неверная дата рождения")

    ward_with_free_bed(conn, body.ward_id)

    # The procedure would quietly turn this into a transfer; the desk must ask for one
    existing = conn.execute('SELECT "PatientID" FROM "Patient" WHERE "Phone" = %s', (body.phone,)).fetchone()
    if existing:
        current = active_admission(conn, existing[0])
        if current:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"Пациент с этим телефоном уже лежит в палате «{current.ward_name}». "
                "Чтобы сменить палату, используйте перевод",
            )

    with database_rules():
        conn.execute(
            "CALL sp_RegisterAndAdmitPatient(%s, %s, %s, %s, %s)",
            (body.full_name.strip(), body.dob, body.phone, body.gender, body.ward_id),
        )

    row = conn.execute(ACTIVE_SQL + ' AND p."Phone" = %s', (body.phone,)).fetchone()
    return admission_from_row(row)


@router.post("/{patient_id}/transfer")
def transfer(patient_id: int, body: Transfer, conn: Connection = Depends(admissions_db)) -> ActiveAdmission:
    """Move an admitted patient to another ward; the old admission is closed (UC-2)."""
    current = active_admission(conn, patient_id)
    if current is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пациент сейчас не лежит в отделении")
    if current.ward_id == body.ward_id:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Пациент уже лежит в палате «{current.ward_name}»")

    ward_with_free_bed(conn, body.ward_id)

    with database_rules():
        conn.execute("CALL sp_AdmitPatient(%s, %s)", (patient_id, body.ward_id))

    return active_admission(conn, patient_id)


@router.post("/{patient_id}/discharge", status_code=status.HTTP_204_NO_CONTENT)
def discharge(patient_id: int, conn: Connection = Depends(admissions_db)) -> Response:
    """Close the patient's active admission (UC-3)."""
    if active_admission(conn, patient_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пациент сейчас не лежит в отделении")

    with database_rules():
        conn.execute("CALL sp_DischargePatient(%s)", (patient_id,))

    return Response(status_code=status.HTTP_204_NO_CONTENT)
