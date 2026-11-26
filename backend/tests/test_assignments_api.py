"""Ward assignments API (/api/assignments): the head nurse's assignment screen.

Rules from the task (part 3):
  - only the head nurse changes assignments;
  - every ward has exactly one primary nurse: she is taken off only by naming another;
  - the backend checks the rule, the database procedure re-checks it;
  - new alerts follow the new assignment at once, existing ones stay with their nurse;
  - every change is written to the journal: who, when, what.

Seed state (db/04_seed.sql):
  ward 101: NURSE-01 primary, NURSE-02 additional
  ward 102: NURSE-02 primary;  ward 103: NURSE-03 primary
  ward 104: NURSE-04 primary, NURSE-05 additional (off shift)
  NURSE-10 head nurse, no ward;  ALT-1001 CRITICAL PENDING ward 101, assigned NURSE-01
"""

import psycopg
import pytest

from tests.conftest import (
    ADMIN_URL, ADMISSIONS, HEAD_NURSE, NURSE, NURSE_2, NURSE_3, PUBLIC_STAFF, login,
)

pytestmark = pytest.mark.usefixtures("seed_data")

HEAD_NURSE_ID = "NURSE-10"


# --- Helpers ---------------------------------------------------------------------------

def ward(client, ward_id: int) -> dict:
    login(client, HEAD_NURSE)
    response = client.get("/api/assignments")
    assert response.status_code == 200, response.text
    return next(w for w in response.json()["wards"] if w["ward_id"] == ward_id)


def nurses_of(client, ward_id: int) -> dict[str, bool]:
    """nurse_id -> is_primary for the ward."""
    return {n["nurse_id"]: n["is_primary"] for n in ward(client, ward_id)["nurses"]}


def set_primary(client, ward_id: int, nurse_id: str, reason: str | None = None):
    login(client, HEAD_NURSE)
    return client.put(f"/api/assignments/{ward_id}/primary", json={"nurse_id": nurse_id, "reason": reason})


def add_nurse(client, ward_id: int, nurse_id: str):
    login(client, HEAD_NURSE)
    return client.post(f"/api/assignments/{ward_id}/nurses", json={"nurse_id": nurse_id})


def remove_nurse(client, ward_id: int, nurse_id: str):
    login(client, HEAD_NURSE)
    return client.delete(f"/api/assignments/{ward_id}/nurses/{nurse_id}")


def journal(client, **params) -> list[dict]:
    login(client, HEAD_NURSE)
    response = client.get("/api/assignments/log", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def assignment_rows() -> list[tuple]:
    with psycopg.connect(ADMIN_URL) as conn:
        return conn.execute(
            'SELECT "WardID", "NurseID", "IsPrimary" FROM "NurseAssignment" ORDER BY 1, 2'
        ).fetchall()


def raise_alert(client, ward_id: int) -> dict:
    login(client, NURSE)
    response = client.post("/api/simulator/alerts", json={
        "ward_id": ward_id, "source": "CALL_BUTTON", "priority": "HIGH"})
    assert response.status_code == 201, response.text
    return response.json()


# --- Who may use the screen ------------------------------------------------------------

REQUESTS = [
    ("GET", "/api/assignments", None),
    ("GET", "/api/assignments/log", None),
    ("PUT", "/api/assignments/101/primary", {"nurse_id": "NURSE-02"}),
    ("POST", "/api/assignments/101/nurses", {"nurse_id": "NURSE-03"}),
    ("DELETE", "/api/assignments/101/nurses/NURSE-02", None),
]


@pytest.mark.parametrize("method,path,body", REQUESTS)
def test_anonymous_gets_401(client, method, path, body):
    assert client.request(method, path, json=body).status_code == 401


@pytest.mark.parametrize("account", [ADMISSIONS, PUBLIC_STAFF, NURSE], ids=["admissions", "public", "nurse"])
@pytest.mark.parametrize("method,path,body", REQUESTS)
def test_only_the_head_nurse_may_use_assignments(client, account, method, path, body):
    before = assignment_rows()
    login(client, account)

    assert client.request(method, path, json=body).status_code == 403
    assert assignment_rows() == before


# --- The board -------------------------------------------------------------------------

def test_board_shows_primary_and_additional_nurses_of_each_ward(client):
    login(client, HEAD_NURSE)
    board = client.get("/api/assignments").json()

    wards = {w["ward_id"]: w for w in board["wards"]}
    assert set(wards) == {101, 102, 103, 104}
    assert wards[101]["primary_nurse_id"] == "NURSE-01"
    # Primary first, then additional
    assert [(n["nurse_id"], n["is_primary"]) for n in wards[101]["nurses"]] == [
        ("NURSE-01", True), ("NURSE-02", False)]
    assert wards[104]["primary_nurse_id"] == "NURSE-04"
    assert {n["nurse_id"] for n in board["nurses"]} >= {"NURSE-01", "NURSE-05", HEAD_NURSE_ID}


def test_board_has_no_patient_data(client):
    login(client, HEAD_NURSE)
    text = client.get("/api/assignments").text

    assert "Akezhan" not in text and "patient" not in text.lower()


# --- Primary nurse ---------------------------------------------------------------------

def test_head_nurse_replaces_the_primary_nurse_and_the_old_one_stays_additional(client):
    response = set_primary(client, 101, "NURSE-03", reason="Shift rotation")

    assert response.status_code == 200, response.text
    assert response.json()["primary_nurse_id"] == "NURSE-03"
    assert nurses_of(client, 101) == {"NURSE-03": True, "NURSE-01": False, "NURSE-02": False}


def test_an_additional_nurse_can_be_made_primary(client):
    assert set_primary(client, 101, "NURSE-02").status_code == 200

    assert nurses_of(client, 101) == {"NURSE-02": True, "NURSE-01": False}


def test_making_the_current_primary_nurse_primary_changes_nothing(client):
    response = set_primary(client, 101, "NURSE-01")

    assert response.status_code == 200
    assert response.json()["primary_nurse_id"] == "NURSE-01"
    assert journal(client) == []


def test_off_shift_nurse_cannot_be_made_primary(client):
    before = assignment_rows()
    response = set_primary(client, 104, "NURSE-05")

    assert response.status_code == 409
    assert "не на смене" in response.json()["detail"]
    assert assignment_rows() == before


def test_unknown_ward_or_nurse_is_404(client):
    assert set_primary(client, 999, "NURSE-01").status_code == 404
    assert set_primary(client, 101, "NURSE-99").status_code == 404
    assert add_nurse(client, 999, "NURSE-03").status_code == 404


def test_empty_nurse_id_is_rejected(client):
    login(client, HEAD_NURSE)
    assert client.put("/api/assignments/101/primary", json={"nurse_id": ""}).status_code == 422


# --- Additional nurses -----------------------------------------------------------------

def test_head_nurse_adds_an_additional_nurse(client):
    response = add_nurse(client, 101, "NURSE-03")

    assert response.status_code == 200, response.text
    assert nurses_of(client, 101) == {"NURSE-01": True, "NURSE-02": False, "NURSE-03": False}


def test_adding_a_nurse_who_is_already_there_changes_nothing(client):
    assert add_nurse(client, 101, "NURSE-02").status_code == 200

    assert nurses_of(client, 101) == {"NURSE-01": True, "NURSE-02": False}
    assert journal(client) == []


def test_primary_nurse_cannot_be_demoted_to_additional(client):
    response = add_nurse(client, 101, "NURSE-01")

    assert response.status_code == 409
    assert "сначала назначьте другую основную" in response.json()["detail"]
    assert nurses_of(client, 101)["NURSE-01"] is True


def test_off_shift_nurse_cannot_be_added(client):
    assert add_nurse(client, 101, "NURSE-05").status_code == 409


def test_head_nurse_removes_an_additional_nurse(client):
    response = remove_nurse(client, 101, "NURSE-02")

    assert response.status_code == 204
    assert nurses_of(client, 101) == {"NURSE-01": True}


def test_primary_nurse_cannot_be_removed(client):
    before = assignment_rows()
    response = remove_nurse(client, 101, "NURSE-01")

    assert response.status_code == 409
    assert "Сначала назначьте другую основную" in response.json()["detail"]
    assert assignment_rows() == before


def test_removing_a_nurse_who_does_not_work_in_the_ward_is_404(client):
    assert remove_nurse(client, 101, "NURSE-04").status_code == 404


def test_every_ward_keeps_exactly_one_primary_nurse_after_a_series_of_changes(client):
    assert set_primary(client, 101, "NURSE-03").status_code == 200
    assert set_primary(client, 101, "NURSE-01").status_code == 200
    assert remove_nurse(client, 101, "NURSE-03").status_code == 204
    assert add_nurse(client, 104, "NURSE-02").status_code == 200
    assert set_primary(client, 104, "NURSE-02").status_code == 200

    login(client, HEAD_NURSE)
    for w in client.get("/api/assignments").json()["wards"]:
        assert sum(n["is_primary"] for n in w["nurses"]) == 1, w


# --- The database re-checks the rule ---------------------------------------------------

def test_database_refusal_becomes_409_not_a_server_error(client, monkeypatch):
    # Skip the backend check: the procedure must still refuse the demotion
    from app.routers import assignments

    monkeypatch.setattr(assignments, "get_ward", lambda conn, ward_id: assignments.WardAssignment(
        ward_id=ward_id, ward_name="ICU", primary_nurse_id=None, nurses=[]))

    response = add_nurse(client, 101, "NURSE-01")

    assert response.status_code == 409
    assert "База данных отклонила операцию" in response.json()["detail"]
    assert nurses_of(client, 101)["NURSE-01"] is True


# --- The journal -----------------------------------------------------------------------

def test_every_change_is_written_to_the_journal_with_who_when_what(client):
    set_primary(client, 101, "NURSE-03", reason="Shift rotation")
    remove_nurse(client, 101, "NURSE-02")
    add_nurse(client, 104, "NURSE-01")

    entries = journal(client)

    # Newest first
    assert [(e["action"], e["ward_id"], e["nurse_id"]) for e in entries] == [
        ("ASSIGN_ADDITIONAL", 104, "NURSE-01"),
        ("REMOVE_ADDITIONAL", 101, "NURSE-02"),
        ("ASSIGN_PRIMARY", 101, "NURSE-03"),
    ]
    swap = entries[-1]
    assert swap["previous_primary_nurse_id"] == "NURSE-01"
    assert swap["changed_by_nurse_id"] == HEAD_NURSE_ID
    assert swap["changed_by_name"] == "Gulnara Akhmetova"
    assert swap["reason"] == "Shift rotation"
    assert swap["changed_at"]


def test_journal_can_be_filtered_by_ward_and_limited(client):
    set_primary(client, 101, "NURSE-03")
    add_nurse(client, 104, "NURSE-01")

    assert [e["ward_id"] for e in journal(client, ward_id=104)] == [104]
    assert len(journal(client, limit=1)) == 1

    login(client, HEAD_NURSE)
    assert client.get("/api/assignments/log", params={"limit": 0}).status_code == 422


def test_refused_change_is_not_written_to_the_journal(client):
    remove_nurse(client, 101, "NURSE-01")
    set_primary(client, 104, "NURSE-05")

    assert journal(client) == []


# --- Alerts follow the new assignment ----------------------------------------------------

def test_new_alert_goes_to_the_new_primary_nurse_and_old_alert_stays(client):
    assert set_primary(client, 101, "NURSE-03").status_code == 200

    assert raise_alert(client, 101)["assigned_nurse_id"] == "NURSE-03"

    login(client, HEAD_NURSE)
    board = client.get("/api/alerts").json()
    old = next(a for a in board["open"] if a["alert_id"] == "ALT-1001")
    assert old["assigned_nurse_id"] == "NURSE-01"


def test_new_primary_nurse_sees_the_ward_alerts_on_her_post(client):
    assert set_primary(client, 101, "NURSE-03").status_code == 200

    login(client, NURSE_3)
    assert "ALT-1001" in {a["alert_id"] for a in client.get("/api/alerts").json()["open"]}


def test_removed_nurse_no_longer_sees_the_ward_alerts(client):
    login(client, NURSE_2)
    assert "ALT-1001" in {a["alert_id"] for a in client.get("/api/alerts").json()["open"]}

    assert remove_nurse(client, 101, "NURSE-02").status_code == 204

    # ALT-1001 is NURSE-01's alert of ward 101, where NURSE-02 no longer works
    login(client, NURSE_2)
    assert "ALT-1001" not in {a["alert_id"] for a in client.get("/api/alerts").json()["open"]}


# --- Bug found by T-58: the new primary nurse could not go off shift ------------------------

def test_primary_nurse_set_through_the_api_can_go_off_shift(client):
    assert set_primary(client, 104, "NURSE-03").status_code == 200

    login(client, NURSE_3)
    response = client.put("/api/nurses/me/status", json={"status": "OffShift"})

    assert response.status_code == 200, response.text
    primary = ward(client, 104)["primary_nurse_id"]
    assert primary is not None and primary != "NURSE-03"
