"""Week 11 security contribution: real API permissions, not a test-only endpoint.

Author: Shynbulat Kazbek (Kazbekio), Architecture & Security.
The matrix is an independent policy: do not derive expected roles from the app.
Uses real login, signed cookies, FastAPI dependencies and PostgreSQL grants.
"""

from dataclasses import dataclass

import psycopg
import pytest
from psycopg import errors
from psycopg_pool import ConnectionPool

from app.config import settings
from app.db import role_connection
from tests.conftest import (
    ADMISSIONS, HEAD_NURSE, NURSE, NURSE_4, PUBLIC_STAFF, ADMIN_URL, login,
)

pytestmark = pytest.mark.usefixtures("seed_data")

ACCOUNTS = {
    "Anonymous": None,
    "Admissions": ADMISSIONS,
    "PublicStaff": PUBLIC_STAFF,
    "Nurse": NURSE,
    "HeadNurse": HEAD_NURSE,
}


@dataclass(frozen=True)
class Case:
    name: str
    method: str
    path: str
    body: dict | None
    # Admissions, PublicStaff, Nurse, HeadNurse (Anonymous always gets 401).
    statuses: tuple[int, int, int, int]


CASES = [
    Case("current-user", "GET", "/api/auth/me", None, (200, 200, 200, 200)),
    Case("ward-board", "GET", "/api/wards", None, (200, 200, 200, 200)),
    Case("patient-list", "GET", "/api/admissions/active", None, (200, 403, 403, 403)),
    Case("admit", "POST", "/api/admissions", {
        "full_name": "Permissions Test Patient", "dob": "2000-01-10",
        "phone": "+77019990099", "gender": "Male", "ward_id": 104,
    }, (201, 403, 403, 403)),
    Case("transfer", "POST", "/api/admissions/3/transfer", {"ward_id": 103}, (200, 403, 403, 403)),
    Case("discharge", "POST", "/api/admissions/3/discharge", None, (204, 403, 403, 403)),
    Case("alert-list", "GET", "/api/alerts", None, (403, 403, 200, 200)),
    # Head nurse can read all alerts, but has no ward assignment in the seed.
    Case("acknowledge-ward-101", "POST", "/api/alerts/ALT-1001/acknowledge", None, (403, 403, 200, 403)),
    Case("nurse-profile", "GET", "/api/nurses/me", None, (403, 403, 200, 200)),
    Case("nurse-status", "PUT", "/api/nurses/me/status", {"status": "Busy"}, (403, 403, 200, 200)),
    Case("simulator-wards", "GET", "/api/simulator/wards", None, (403, 403, 200, 200)),
    Case("simulator-alert", "POST", "/api/simulator/alerts", {
        "ward_id": 101, "patient_id": 1, "source": "MONITOR", "priority": "HIGH",
    }, (403, 403, 201, 201)),
]


def snapshot() -> dict:
    """All business rows, not just counts: a denied request must not alter data."""
    tables = ("Patient", "Ward", "Admission", "Nurse", "NurseAssignment",
              "StaffAccount", "WardAlert", "AlertEvent")
    with psycopg.connect(ADMIN_URL) as conn:
        return {
            table: conn.execute(
                psycopg.sql.SQL("SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM {} t")
                .format(psycopg.sql.Identifier(table))
            ).fetchone()[0]
            for table in tables
        }


@pytest.mark.parametrize("role", ACCOUNTS)
@pytest.mark.parametrize("case", CASES, ids=lambda case: case.name)
def test_api_permission_matrix(client, role, case, record_property):
    if ACCOUNTS[role]:
        login(client, ACCOUNTS[role])
    expected = 401 if role == "Anonymous" else case.statuses[list(ACCOUNTS).index(role) - 1]
    before = snapshot() if expected in (401, 403) else None

    response = client.request(case.method, case.path, json=case.body)

    record_property("request", f"{case.method} {case.path}")
    record_property("role", role)
    record_property("expected", str(expected))
    record_property("actual", str(response.status_code))
    assert response.status_code == expected, response.text
    if before is not None:
        assert response.json() == {"detail": "Требуется вход" if expected == 401 else (
            "Это оповещение не вашей палаты" if role == "HeadNurse" and case.name == "acknowledge-ward-101"
            else "Недостаточно прав"
        )}
        assert snapshot() == before, "Denied request changed business data"


def test_role_denied_before_database_access(client, monkeypatch):
    login(client, PUBLIC_STAFF)

    def forbidden_connection(*args, **kwargs):
        pytest.fail("Role-denied API must not open a database connection")

    monkeypatch.setattr(client.app.state.pool, "connection", forbidden_connection)
    assert client.get("/api/admissions/active").status_code == 403


def test_client_cannot_promote_own_role(client):
    login(client, PUBLIC_STAFF)
    response = client.get(
        "/api/admissions/active?role=Admissions",
        headers={"X-Role": "Admissions", "X-Account-ID": "ADM-01"},
    )
    assert response.status_code == 403
    assert client.get("/api/auth/me").json()["role"] == "PublicStaff"


def test_public_board_contains_only_capacity_fields(client):
    login(client, PUBLIC_STAFF)
    rows = client.get("/api/wards").json()
    assert rows
    fields = {"ward_id", "ward_name", "floor", "ward_type", "capacity", "occupied", "available"}
    assert all(set(row) == fields for row in rows)
    assert client.get("/api/admissions/active").status_code == 403


def test_foreign_ward_acknowledgement_is_denied_without_changes(client):
    login(client, NURSE_4)  # Ward 104; alert belongs to ward 101.
    before = snapshot()
    assert client.post("/api/alerts/ALT-1001/acknowledge").status_code == 403
    assert snapshot() == before


def test_unauthorized_nurse_cannot_probe_existing_patient_ids(client):
    login(client, NURSE)
    for patient in (3, 999999):
        assert client.post(f"/api/admissions/{patient}/discharge").status_code == 403


def test_disabled_simulator_is_not_available_even_to_head_nurse(client, monkeypatch):
    login(client, HEAD_NURSE)
    monkeypatch.setattr(settings, "simulator_enabled", False)
    before = snapshot()
    assert client.get("/api/simulator/wards").status_code == 404
    assert client.post("/api/simulator/alerts", json=CASES[-1].body).status_code == 404
    assert snapshot() == before


@pytest.mark.parametrize(("db_role", "query"), [
    ("medbase_public_staff", 'SELECT "FullName" FROM "Patient"'),
    ("medbase_public_staff", 'CALL sp_DischargePatient(3)'),
    ("medbase_nurse", 'SELECT "Phone" FROM "Patient"'),
    ("medbase_nurse", 'SELECT "PinHash" FROM "Nurse"'),
    ("medbase_nurse", 'CALL sp_AdmitPatient(7, 104)'),
    ("medbase_nurse", 'UPDATE "WardAlert" SET "Description" = \'changed\' WHERE "AlertID" = \'ALT-1001\''),
    ("medbase_nurse", 'DELETE FROM "AlertEvent"'),
    ("medbase_admissions", 'CALL sp_AcknowledgeAlert(\'ALT-1001\', \'NURSE-01\')'),
])
def test_database_denies_operation_even_without_api_guard(client, db_role, query):
    before = snapshot()
    with pytest.raises(errors.InsufficientPrivilege):
        with role_connection(client.app.state.pool, db_role) as conn:
            conn.execute(query)
    assert snapshot() == before


@pytest.mark.parametrize("rollback", [False, True], ids=["commit", "rollback"])
def test_local_role_does_not_leak_to_next_pool_user(rollback):
    # A single physical connection makes reuse certain, rather than accidental.
    with ConnectionPool(settings.database_url, min_size=1, max_size=1) as pool:
        try:
            with role_connection(pool, "medbase_admissions") as conn:
                pid = conn.execute("SELECT pg_backend_pid()").fetchone()[0]
                conn.execute('SELECT "Phone" FROM "Patient"')
                if rollback:
                    raise RuntimeError("Force rollback")
        except RuntimeError:
            if not rollback:
                raise

        with pool.connection() as conn:
            assert conn.execute("SELECT current_user, pg_backend_pid()").fetchone() == ("medbase_api", pid)
            with pytest.raises(errors.InsufficientPrivilege):
                conn.execute('SELECT "FullName" FROM "Patient"')

        with role_connection(pool, "medbase_public_staff") as conn:
            assert conn.execute("SELECT pg_backend_pid()").fetchone()[0] == pid
            assert conn.execute('SELECT COUNT(*) FROM "vw_WardCapacity"').fetchone()[0] == 4
            with pytest.raises(errors.InsufficientPrivilege):
                conn.execute('SELECT "Phone" FROM "Patient"')
