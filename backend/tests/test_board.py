"""Corridor board summary (part 4): GET /api/board/summary.

Rules from the task:
  - no login, read only;
  - per ward: occupancy and active alerts with priority, waiting time, whether escalated,
    whether staff from outside the ward is being called;
  - no patient data (NFR-03): no names, no alert descriptions, only ward and priority;
  - its own endpoint that returns only the summary;
  - without login only from the internal network or from known screens.

Seed state (db/04_seed.sql):
  ward 101 ICU 2/2 (full), 102 2/4, 103 0/3, 104 0/5
  ALT-1001 CRITICAL PENDING   ward 101, NURSE-01, 5 minutes old
  ALT-1003 CRITICAL ESCALATED ward 101, NURSE-01 -> NURSE-03 (works in 102 and 103), 30 minutes old
  ALT-1005 HIGH     PENDING   ward 102, NURSE-02, 10 seconds old
  ALT-1002, ALT-1004, ALT-1006 acknowledged
"""

from contextlib import contextmanager

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from tests.conftest import ADMIN_URL, NURSE, login, run_as_owner

pytestmark = pytest.mark.usefixtures("seed_data")

SUMMARY = "/api/board/summary"
SCREEN_TOKEN = "corridor-screen-2nd-floor-7f3a9c"


# --- Helpers ---------------------------------------------------------------------------

@contextmanager
def client_from(address: str):
    """A test client whose requests come from `address`."""
    with TestClient(app, client=(address, 50000)) as test_client:
        yield test_client


@pytest.fixture
def board():
    """The board as a screen in the internal network sees it."""
    with client_from("192.168.10.21") as test_client:
        yield test_client


def summary(board) -> dict:
    response = board.get(SUMMARY)
    assert response.status_code == 200, response.text
    return response.json()


def wards(board) -> dict[int, dict]:
    return {w["ward_id"]: w for w in summary(board)["wards"]}


def fetch_column(sql: str) -> list[str]:
    with psycopg.connect(ADMIN_URL) as conn:
        return [row[0] for row in conn.execute(sql).fetchall()]


# --- No login, read only ---------------------------------------------------------------

def test_board_needs_no_login_and_sets_no_cookie(board):
    response = board.get(SUMMARY)

    assert response.status_code == 200, response.text
    assert "set-cookie" not in response.headers


def test_summary_is_never_cached(board):
    assert board.get(SUMMARY).headers["cache-control"] == "no-store"


@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
def test_board_is_read_only(board, method):
    assert board.request(method, SUMMARY).status_code == 405


def test_board_asks_for_a_refresh_every_one_to_two_seconds(board):
    assert 1 <= summary(board)["refresh_seconds"] <= 2


# --- Occupancy ---------------------------------------------------------------------------

def test_every_ward_with_its_occupancy(board):
    shown = {w["ward_id"]: (w["occupied"], w["capacity"], w["available"]) for w in summary(board)["wards"]}

    assert shown == {101: (2, 2, 0), 102: (2, 4, 2), 103: (0, 3, 3), 104: (0, 5, 5), 105: (0, 8, 8)}


def test_occupancy_follows_admissions(board, client):
    run_as_owner("""UPDATE "Admission" SET "Status" = 'Discharged', "DischargeDate" = CURRENT_DATE
                    WHERE "PatientID" = 1 AND "Status" = 'Active'""")

    assert wards(board)[101]["occupied"] == 1


# --- Active alerts -----------------------------------------------------------------------

def test_only_active_alerts_most_urgent_first(board):
    shown = wards(board)

    assert [(a["priority"], a["status"]) for a in shown[101]["alerts"]] == [
        ("CRITICAL", "ESCALATED"),  # ALT-1003, waits 30 minutes
        ("CRITICAL", "PENDING"),    # ALT-1001, waits 5 minutes
    ]
    assert [(a["priority"], a["status"]) for a in shown[102]["alerts"]] == [("HIGH", "PENDING")]
    assert shown[103]["alerts"] == [] and shown[104]["alerts"] == []


def test_waiting_time_in_seconds(board):
    escalated, pending = wards(board)[101]["alerts"]

    assert 30 * 60 <= escalated["waiting_seconds"] < 31 * 60
    assert 5 * 60 <= pending["waiting_seconds"] < 6 * 60


def test_escalated_to_a_nurse_of_another_ward_is_an_outside_call(board):
    escalated, pending = wards(board)[101]["alerts"]

    # ALT-1003 went to NURSE-03, who does not work in ward 101
    assert escalated["escalated"] is True and escalated["outside_call"] is True
    assert pending["escalated"] is False and pending["outside_call"] is False
    assert escalated["no_nurse"] is False and pending["no_nurse"] is False


def test_escalated_to_a_nurse_of_the_same_ward_is_not_an_outside_call(board):
    # ALT-1001 (ward 101, 5 minutes old) goes to NURSE-02, who also works in ward 101
    run_as_owner("""UPDATE "Nurse" SET "Status" = 'Available' WHERE "NurseID" = 'NURSE-02'""")
    run_as_owner("CALL sp_EscalateAlert('ALT-1001', 'NURSE-02')")

    alerts = wards(board)[101]["alerts"]

    assert [(a["escalated"], a["outside_call"]) for a in alerts] == [(True, True), (True, False)]


def test_alert_nobody_on_shift_was_given_is_marked(board, client):
    run_as_owner("""UPDATE "Nurse" SET "Status" = 'OffShift'""")
    login(client, NURSE)
    response = client.post("/api/simulator/alerts", json={
        "ward_id": 104, "source": "CALL_BUTTON", "priority": "HIGH"})
    assert response.status_code == 201, response.text
    assert response.json()["assigned_nurse_id"] is None

    [alert] = wards(board)[104]["alerts"]

    assert alert["no_nurse"] is True and alert["priority"] == "HIGH"


def test_new_alert_appears_and_acknowledged_alert_disappears(board, client):
    login(client, NURSE)
    response = client.post("/api/simulator/alerts", json={
        "ward_id": 104, "source": "CALL_BUTTON", "priority": "LOW"})
    assert response.status_code == 201, response.text
    assert [a["priority"] for a in wards(board)[104]["alerts"]] == ["LOW"]

    assert client.post("/api/alerts/ALT-1001/acknowledge").status_code == 200

    assert [a["status"] for a in wards(board)[101]["alerts"]] == ["ESCALATED"]


# --- No patient data (NFR-03) ------------------------------------------------------------

def test_summary_has_no_patient_data_and_no_names(board):
    text = summary(board).__repr__() + board.get(SUMMARY).text

    secrets = (
        fetch_column('SELECT "FullName" FROM "Patient"')
        + fetch_column('SELECT "Phone" FROM "Patient" WHERE "Phone" IS NOT NULL')
        + fetch_column('SELECT "Description" FROM "WardAlert" WHERE "Description" IS NOT NULL')
        + fetch_column('SELECT "FullName" FROM "Nurse"')
        + fetch_column('SELECT "NurseID" FROM "Nurse"')
        + fetch_column('SELECT "AlertID" FROM "WardAlert"')
    )
    assert secrets, "seed data must be loaded"
    for value in secrets:
        assert value not in text, value


def test_summary_has_only_the_agreed_fields(board):
    data = summary(board)
    ward = data["wards"][0]
    alert = next(a for w in data["wards"] for a in w["alerts"])

    assert set(data) == {"generated_at", "refresh_seconds", "wards"}
    assert set(ward) == {"ward_id", "ward_name", "floor", "capacity", "occupied", "available", "alerts"}
    assert set(alert) == {"priority", "status", "waiting_seconds", "escalated", "outside_call", "no_nurse"}


# --- Who may open the board ----------------------------------------------------------------

@pytest.mark.parametrize("address", ["127.0.0.1", "::1", "10.20.30.40", "172.20.0.9", "192.168.1.5"])
def test_internal_networks_get_the_board(address):
    with client_from(address) as board:
        assert board.get(SUMMARY).status_code == 200


@pytest.mark.parametrize("address", ["8.8.8.8", "203.0.113.7", "2001:db8::1", "testclient"])
def test_outside_addresses_are_refused_without_data(address):
    with client_from(address) as board:
        response = board.get(SUMMARY)

    assert response.status_code == 403
    assert response.json() == {"detail": "Этот экран не допущен к табло"}


def test_signed_in_staff_from_outside_still_cannot_open_the_board():
    with client_from("8.8.8.8") as outside:
        login(outside, NURSE)
        assert outside.get(SUMMARY).status_code == 403


def test_known_screen_outside_the_network_gets_the_board_with_its_token(monkeypatch):
    monkeypatch.setattr(settings, "board_screen_tokens", f"other-screen-token, {SCREEN_TOKEN}")

    with client_from("8.8.8.8") as screen:
        assert screen.get(SUMMARY, headers={"X-Board-Screen": SCREEN_TOKEN}).status_code == 200
        assert screen.get(SUMMARY, headers={"X-Board-Screen": "guessed-token"}).status_code == 403
        assert screen.get(SUMMARY, headers={"X-Board-Screen": SCREEN_TOKEN[:-1]}).status_code == 403
        assert screen.get(SUMMARY).status_code == 403


def test_empty_token_opens_nothing_when_no_tokens_are_configured(monkeypatch):
    monkeypatch.setattr(settings, "board_screen_tokens", "")

    with client_from("8.8.8.8") as screen:
        assert screen.get(SUMMARY, headers={"X-Board-Screen": ""}).status_code == 403


def test_real_address_from_the_board_proxy_is_used():
    # The board's nginx (a trusted proxy) passes on where the screen really is
    with client_from("172.18.0.5") as proxy:
        assert proxy.get(SUMMARY, headers={"X-Real-IP": "8.8.8.8"}).status_code == 403
        assert proxy.get(SUMMARY, headers={"X-Real-IP": "192.168.1.20"}).status_code == 200


def test_forged_real_address_from_outside_is_ignored():
    with client_from("8.8.8.8") as outside:
        assert outside.get(SUMMARY, headers={"X-Real-IP": "127.0.0.1"}).status_code == 403


def test_allowed_networks_are_configurable(monkeypatch):
    monkeypatch.setattr(settings, "board_allowed_networks", "10.1.0.0/16")

    with client_from("10.1.2.3") as inside, client_from("192.168.1.5") as other:
        assert inside.get(SUMMARY).status_code == 200
        assert other.get(SUMMARY).status_code == 403


def test_board_endpoint_returns_only_the_summary(board):
    # The board has no other routes: nothing else of the API opens without login
    paths = {path: set(ops) for path, ops in board.get("/api/openapi.json").json()["paths"].items()
             if path.startswith("/api/board")}

    assert paths == {SUMMARY: {"get"}}
    assert board.get("/api/board").status_code == 404
