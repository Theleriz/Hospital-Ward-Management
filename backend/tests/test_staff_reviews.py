"""Assignment-scoped staff review tests; run against a dedicated test database."""

import psycopg
import pytest
from psycopg.errors import InsufficientPrivilege

from conftest import ADMIN_URL, NURSE, login, run_as_owner

DOCTOR_A = {"badge_id": "BADGE-DOCTOR-A", "pin": "9101"}
DOCTOR_B = {"badge_id": "BADGE-DOCTOR-B", "pin": "9102"}
DOCTOR_UNASSIGNED = {"badge_id": "BADGE-DOCTOR-C", "pin": "9103"}


def add_test_doctors():
    for account_id, full_name, badge, pin in (
        ("DOC-A", "Врач Учебный А", "BADGE-DOCTOR-A", "9101"),
        ("DOC-B", "Врач Учебный Б", "BADGE-DOCTOR-B", "9102"),
        ("DOC-C", "Врач Учебный В", "BADGE-DOCTOR-C", "9103"),
    ):
        run_as_owner(
            '''INSERT INTO "StaffAccount" ("AccountID", "FullName", "BadgeID", "PinHash", "Role")
               VALUES (%s, %s, %s, crypt(%s, gen_salt('bf')), 'Doctor')''',
            (account_id, full_name, badge, pin),
        )


def add_request(client, patient_id: int) -> int:
    response = client.post(
        "/api/staff-reviews", json={"patient_id": patient_id, "reason": "Синтетический повод для проверки"}
    )
    assert response.status_code == 201, response.text
    return response.json()["request_id"]


def alert_ids() -> set[str]:
    with psycopg.connect(ADMIN_URL) as conn:
        return {row[0] for row in conn.execute('SELECT "AlertID" FROM "WardAlert"').fetchall()}


def test_explicit_request_is_idempotent_and_does_not_create_an_alert(client, seed_data):
    login(client, NURSE)
    before = alert_ids()
    payload = {"patient_id": 1, "reason": "Учебные измерения не подтверждены"}
    first = client.post("/api/staff-reviews", json=payload)
    repeated = client.post("/api/staff-reviews", json=payload)
    assert first.status_code == repeated.status_code == 201
    assert first.json()["request_id"] == repeated.json()["request_id"]
    assert first.json()["requested_by"] == "NURSE-01"
    assert first.json()["status"] == "PENDING"
    assert alert_ids() == before


def test_non_nurse_roles_cannot_submit_requests(client, seed_data):
    from conftest import PUBLIC_STAFF

    login(client, PUBLIC_STAFF)
    result = client.post("/api/staff-reviews", json={"patient_id": 1, "reason": "Проверить"})
    assert result.status_code == 403


def test_doctors_only_see_and_close_requests_for_assigned_patients(client, seed_data):
    add_test_doctors()
    login(client, NURSE)
    request_a = add_request(client, 1)
    request_b = add_request(client, 3)
    run_as_owner(
        'INSERT INTO "DoctorPatientAssignment" ("DoctorAccountID", "PatientID") VALUES (%s, %s)',
        ("DOC-A", 1),
    )
    run_as_owner(
        'INSERT INTO "DoctorPatientAssignment" ("DoctorAccountID", "PatientID") VALUES (%s, %s)',
        ("DOC-B", 3),
    )

    login(client, DOCTOR_A)
    visible_a = client.get("/api/staff-reviews")
    assert visible_a.status_code == 200, visible_a.text
    assert [row["request_id"] for row in visible_a.json()] == [request_a]
    assert client.post(f"/api/staff-reviews/{request_b}/reviewed").status_code == 404
    assert client.post(f"/api/staff-reviews/{request_a}/reviewed").status_code == 200

    login(client, DOCTOR_B)
    visible_b = client.get("/api/staff-reviews")
    assert visible_b.status_code == 200, visible_b.text
    assert [row["request_id"] for row in visible_b.json()] == [request_b]
    assert visible_b.json()[0]["status"] == "PENDING"
    assert client.post(f"/api/staff-reviews/{request_b}/reviewed").status_code == 200


def test_doctor_without_assignment_has_no_access(client, seed_data):
    add_test_doctors()
    login(client, NURSE)
    request_id = add_request(client, 1)

    login(client, DOCTOR_UNASSIGNED)
    listed = client.get("/api/staff-reviews")
    assert listed.status_code == 200, listed.text
    assert listed.json() == []
    assert client.post(f"/api/staff-reviews/{request_id}/reviewed").status_code == 404


def test_doctor_has_no_direct_table_access(client, seed_data):
    with psycopg.connect(ADMIN_URL) as conn:
        with conn.transaction():
            conn.execute("SET LOCAL ROLE medbase_doctor")
            for sql in (
                'SELECT * FROM "StaffReviewRequest"',
                'SELECT * FROM "DoctorPatientAssignment"',
                'SELECT * FROM "Patient"',
            ):
                with pytest.raises(InsufficientPrivilege):
                    with conn.transaction():
                        conn.execute(sql)
