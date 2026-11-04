"""Login with badge + PIN, session, role checks (T-21).

Needs the database from docker-compose.yml with the seed data.
"""

import pytest
from fastapi import Depends
from psycopg import errors

from app.auth import DB_ROLES, Role, require_roles
from app.config import settings
from app.db import role_connection
from app.main import app
from tests.conftest import ADMISSIONS, HEAD_NURSE, INACTIVE, NURSE, PUBLIC_STAFF, login


# Route used only by these tests to check require_roles
@app.get("/api/_test/admissions-only", include_in_schema=False)
def admissions_only(user=Depends(require_roles(Role.ADMISSIONS))):
    return {"account_id": user.account_id}


# --- Login ---------------------------------------------------------------------

@pytest.mark.parametrize(
    ("account", "account_id", "role"),
    [
        (NURSE, "NURSE-01", "Nurse"),
        (HEAD_NURSE, "NURSE-10", "HeadNurse"),
        (ADMISSIONS, "ADM-01", "Admissions"),
        (PUBLIC_STAFF, "STAFF-01", "PublicStaff"),
    ],
)
def test_login_with_badge_and_pin(client, account, account_id, role):
    response = client.post("/api/auth/login", json=account)

    assert response.status_code == 200
    assert response.json()["account_id"] == account_id
    assert response.json()["role"] == role
    assert client.get("/api/auth/me").json()["account_id"] == account_id


@pytest.mark.parametrize(
    "account",
    [
        {"badge_id": "BADGE-1001", "pin": "0000"},  # wrong PIN
        {"badge_id": "BADGE-9999", "pin": "1111"},  # unknown badge
        INACTIVE,
    ],
    ids=["wrong-pin", "unknown-badge", "inactive-account"],
)
def test_login_rejected_with_the_same_message(client, account):
    response = client.post("/api/auth/login", json=account)

    assert response.status_code == 401
    assert response.json()["detail"] == "Неверный бейдж или PIN"
    assert client.get("/api/auth/me").status_code == 401


@pytest.mark.parametrize("pin", ["", "12", "abcd", "123456789"])
def test_login_rejects_malformed_pin(client, pin):
    response = client.post("/api/auth/login", json={"badge_id": "BADGE-1001", "pin": pin})

    assert response.status_code == 422


def test_badge_is_locked_after_too_many_wrong_pins(client):
    wrong = {"badge_id": NURSE["badge_id"], "pin": "0000"}
    for _ in range(settings.login_max_failures):
        assert client.post("/api/auth/login", json=wrong).status_code == 401

    # Even the right PIN is refused while the badge is locked
    response = client.post("/api/auth/login", json=NURSE)
    assert response.status_code == 429
    assert int(response.headers["Retry-After"]) > 0

    # Other badges are not affected
    assert client.post("/api/auth/login", json=ADMISSIONS).status_code == 200


def test_successful_login_resets_failure_count(client):
    wrong = {"badge_id": NURSE["badge_id"], "pin": "0000"}
    for _ in range(settings.login_max_failures - 1):
        client.post("/api/auth/login", json=wrong)
    login(client, NURSE)

    for _ in range(settings.login_max_failures - 1):
        client.post("/api/auth/login", json=wrong)
    assert client.post("/api/auth/login", json=NURSE).status_code == 200


# --- Session -------------------------------------------------------------------

def test_me_requires_login(client):
    assert client.get("/api/auth/me").status_code == 401


def test_session_cookie_is_httponly(client):
    response = client.post("/api/auth/login", json=NURSE)

    cookie = response.headers["set-cookie"].lower()
    assert "medbase_session=" in cookie
    assert "httponly" in cookie
    assert "samesite=lax" in cookie


def test_logout_ends_the_session(client):
    login(client, NURSE)

    assert client.post("/api/auth/logout").status_code == 204
    assert client.get("/api/auth/me").status_code == 401


def test_tampered_session_cookie_is_ignored(client):
    login(client, PUBLIC_STAFF)
    cookie = client.cookies["medbase_session"]
    client.cookies.set("medbase_session", cookie[:-4] + "AAAA")

    assert client.get("/api/auth/me").status_code == 401


# --- Role checks in the backend (first layer) -----------------------------------

def test_role_check_allows_the_right_role(client):
    login(client, ADMISSIONS)

    assert client.get("/api/_test/admissions-only").status_code == 200


@pytest.mark.parametrize("account", [NURSE, HEAD_NURSE, PUBLIC_STAFF])
def test_role_check_forbids_other_roles(client, account):
    login(client, account)

    assert client.get("/api/_test/admissions-only").status_code == 403


def test_role_check_requires_login(client):
    assert client.get("/api/_test/admissions-only").status_code == 401


# --- Role checks in the database (second layer) ----------------------------------
# What each user role may read when the backend acts on its behalf

PATIENT_NAMES = 'SELECT "FullName" FROM "Patient"'
PATIENT_PHONES = 'SELECT "Phone" FROM "Patient"'
ALERTS = 'SELECT "AlertID" FROM "WardAlert"'
CAPACITY = 'SELECT "AvailableBeds" FROM "vw_WardCapacity"'

ALLOWED = {
    Role.ADMISSIONS: {PATIENT_NAMES, PATIENT_PHONES, CAPACITY},
    Role.PUBLIC_STAFF: {CAPACITY},
    Role.NURSE: {PATIENT_NAMES, ALERTS, CAPACITY},
    Role.HEAD_NURSE: {PATIENT_NAMES, ALERTS, CAPACITY},
}


@pytest.mark.parametrize("role", list(Role))
@pytest.mark.parametrize("query", [PATIENT_NAMES, PATIENT_PHONES, ALERTS, CAPACITY])
def test_database_role_of_each_user_role(client, role, query):
    pool = client.app.state.pool
    if query in ALLOWED[role]:
        with role_connection(pool, DB_ROLES[role]) as conn:
            conn.execute(query)
    else:
        with pytest.raises(errors.InsufficientPrivilege):
            with role_connection(pool, DB_ROLES[role]) as conn:
                conn.execute(query)


def test_backend_login_role_alone_reads_nothing(client):
    with client.app.state.pool.connection() as conn:
        with pytest.raises(errors.InsufficientPrivilege):
            conn.execute(PATIENT_NAMES)
