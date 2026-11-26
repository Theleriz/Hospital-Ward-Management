"""Explicit requests for staff review; never creates or escalates an alert."""

from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from psycopg import Connection
from pydantic import BaseModel, Field

from app.auth import Role, User, current_user, role_db

router = APIRouter(prefix="/api/staff-reviews", tags=["staff reviews"])
nurse_db = role_db(Role.NURSE, Role.HEAD_NURSE)
doctor_db = role_db(Role.DOCTOR)


class ReviewRequestInput(BaseModel):
    patient_id: int
    reason: str = Field(min_length=1, max_length=1000)


class ReviewRequest(BaseModel):
    request_id: int
    patient_id: int
    patient_name: str
    patient_dob: date | None
    reason: str
    requested_by: str
    created_at: datetime
    status: str
    reviewed_by: str | None
    reviewed_at: datetime | None


def _request(row) -> ReviewRequest:
    return ReviewRequest(
        request_id=row[0],
        patient_id=row[1],
        patient_name=row[2],
        patient_dob=row[3],
        reason=row[4],
        requested_by=row[5],
        created_at=row[6],
        status=row[7],
        reviewed_by=row[8],
        reviewed_at=row[9],
    )


@router.post("", status_code=status.HTTP_201_CREATED)
def submit_review_request(
    body: ReviewRequestInput,
    user: User = Depends(current_user),
    conn: Connection = Depends(nurse_db),
) -> ReviewRequest:
    """Only a deliberate button click creates a row; pending submissions dedupe by patient."""
    reason = body.reason.strip()
    if not reason:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Укажите причину проверки")
    if conn.execute('SELECT 1 FROM "Patient" WHERE "PatientID" = %s', (body.patient_id,)).fetchone() is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пациент не найден")
    conn.execute(
        '''INSERT INTO "StaffReviewRequest" ("PatientID", "Reason", "RequestedBy")
           VALUES (%s, %s, %s) ON CONFLICT ("PatientID") WHERE "Status" = 'PENDING' DO NOTHING''',
        (body.patient_id, reason, user.account_id),
    )
    row = conn.execute(
        '''SELECT r."RequestID", r."PatientID", p."FullName", NULL::DATE, r."Reason",
                  r."RequestedBy", r."CreatedAt", r."Status", r."ReviewedBy", r."ReviewedAt"
           FROM "StaffReviewRequest" r JOIN "Patient" p USING ("PatientID")
           WHERE r."PatientID" = %s AND r."Status" = 'PENDING' ''',
        (body.patient_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Не удалось создать заявку")
    return _request(row)


@router.get("", response_model=list[ReviewRequest])
def list_review_requests(user: User = Depends(current_user), conn: Connection = Depends(doctor_db)) -> list[ReviewRequest]:
    conn.execute("SELECT set_config('medbase.account_id', %s, true)", (user.account_id,))
    rows = conn.execute(
        'SELECT * FROM fn_ListAssignedStaffReviewRequests()'
    ).fetchall()
    return [_request(row) for row in rows]


@router.post("/{request_id}/reviewed", response_model=ReviewRequest)
def mark_reviewed(request_id: int, user: User = Depends(current_user), conn: Connection = Depends(doctor_db)) -> ReviewRequest:
    conn.execute("SELECT set_config('medbase.account_id', %s, true)", (user.account_id,))
    row = conn.execute(
        'SELECT * FROM fn_MarkAssignedStaffReviewRequestReviewed(%s)', (request_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Заявка не найдена или уже проверена")
    return _request(row)
