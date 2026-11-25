"""Where the nurse is right now: escalation to the nearest nurse and the ward map
(decisions.md, record 14).

Seed state (db/04_seed.sql):
  Wards:  101 and 104 on floor 1, 102 and 103 on floor 2
  NURSE-01  Available  works in 101           is in 101 now
  NURSE-02  Busy       works in 101, 102      is in 101 now
  NURSE-03  Available  works in 102, 103      is in 103 now
  NURSE-04  Available  works in 104           is in 104 now
  NURSE-05  OffShift   works in 104           (no location)
  NURSE-10  Available  head nurse             location unknown
"""

import pytest

from app.config import settings
from app.escalation import LOCATION_FRESH_MINUTES, escalate_overdue
from tests.conftest import (
    ADMISSIONS, HEAD_NURSE, NURSE, NURSE_3, NURSE_4, NURSE_OFF_SHIFT, PUBLIC_STAFF, login, run_as_owner,
)

pytestmark = pytest.mark.usefixtures("seed_data")


# --- Helpers ---------------------------------------------------------------------------

def close_seed_alerts() -> None:
    """Close the open seed alerts, so only the alert of the test is escalated."""
    for alert_id, nurse_id in (("ALT-1001", "NURSE-01"), ("ALT-1003", "NURSE-03"), ("ALT-1005", "NURSE-02")):
        run_as_owner("CALL sp_AcknowledgeAlert(%s, %s)", (alert_id, nurse_id))


def badge_at_door(nurse_id: str, ward_id: int) -> None:
    run_as_owner("CALL sp_SetNurseLocation(%s, %s)", (nurse_id, ward_id))


def location_seen(nurse_id: str, minutes_ago: int) -> None:
    run_as_owner(
        """UPDATE "Nurse" SET "LocationAt" = CURRENT_TIMESTAMP - make_interval(mins => %s)
           WHERE "NurseID" = %s""",
        (minutes_ago, nurse_id),
    )


def overdue_alert_in(client, ward_id: int) -> str:
    """An overdue HIGH alert in `ward_id`, raised by the simulator as NURSE-01."""
    login(client, NURSE)
    response = client.post("/api/simulator/alerts", json={
        "ward_id": ward_id, "source": "CALL_BUTTON", "priority": "HIGH"})
    assert response.status_code == 201, response.text
    alert_id = response.json()["alert_id"]
    run_as_owner(
        """UPDATE "WardAlert" SET "CreatedAt" = CURRENT_TIMESTAMP - INTERVAL '1 minute'
           WHERE "AlertID" = %s""",
        (alert_id,),
    )
    return alert_id


def escalate(client) -> dict[str, str]:
    return dict(escalate_overdue(client.app.state.pool))


# --- Escalation calls the nurse who is nearest right now ---------------------------------

def test_nurse_in_the_ward_right_now_is_called_first(client):
    close_seed_alerts()
    alert = overdue_alert_in(client, 101)
    # NURSE-03 works on floor 2, but has just entered ward 101
    badge_at_door("NURSE-03", 101)

    # ...so she or he goes before NURSE-04, who works on floor 1 but is in ward 104
    assert escalate(client)[alert] == "NURSE-03"


def test_where_the_nurse_is_beats_the_work_schedule(client):
    close_seed_alerts()
    alert = overdue_alert_in(client, 101)
    # Swap: NURSE-03 (works on floor 2) is on floor 1 now, NURSE-04 (works on floor 1) on floor 2
    badge_at_door("NURSE-03", 104)
    badge_at_door("NURSE-04", 103)

    assert escalate(client)[alert] == "NURSE-03"


def test_without_location_changes_the_schedule_decides(client):
    close_seed_alerts()
    alert = overdue_alert_in(client, 101)
    run_as_owner('UPDATE "Nurse" SET "CurrentWardID" = NULL, "LocationAt" = NULL')

    # Nobody's location is known: NURSE-04 works on floor 1, NURSE-03 on floor 2
    assert escalate(client)[alert] == "NURSE-04"


def test_old_location_is_not_trusted(client):
    close_seed_alerts()
    alert = overdue_alert_in(client, 101)
    badge_at_door("NURSE-03", 101)
    # ...but that was long ago; she or he may be anywhere now
    location_seen("NURSE-03", LOCATION_FRESH_MINUTES + 5)

    # Falls back to the schedule: NURSE-03 works on floor 2, NURSE-04 is on floor 1 now
    assert escalate(client)[alert] == "NURSE-04"


def test_free_nurse_far_away_goes_before_a_busy_nurse_in_the_ward(client):
    close_seed_alerts()
    alert = overdue_alert_in(client, 103)
    # NURSE-02 is Busy, but right in ward 103; NURSE-01 is free on floor 1
    badge_at_door("NURSE-02", 103)
    run_as_owner("""UPDATE "Nurse" SET "Status" = 'Busy' WHERE "NurseID" IN ('NURSE-03', 'NURSE-10')""")

    # Status first (decisions.md, record 12), location second: NURSE-01 and NURSE-04 are
    # both free and one floor away, the nurse ID breaks the tie
    assert escalate(client)[alert] == "NURSE-01"


def test_busy_nurse_in_the_ward_goes_before_a_busy_nurse_far_away(client):
    close_seed_alerts()
    alert = overdue_alert_in(client, 103)
    badge_at_door("NURSE-02", 103)
    run_as_owner("""UPDATE "Nurse" SET "Status" = 'Busy' WHERE "Status" = 'Available' AND "NurseID" <> 'NURSE-01'""")
    run_as_owner("""UPDATE "Nurse" SET "Status" = 'OffShift' WHERE "NurseID" = 'NURSE-01'""")

    # Nobody is free: NURSE-02 (Busy, in ward 103) before NURSE-04 (Busy, floor 1)
    assert escalate(client)[alert] == "NURSE-02"


# --- The nurse marks where she or he is (nurse post) -----------------------------------------

def test_nurse_marks_the_ward_she_or_he_is_in(client):
    login(client, NURSE_4)

    response = client.put("/api/nurses/me/location", json={"ward_id": 102})

    assert response.status_code == 200
    assert response.json()["current_ward_id"] == 102
    assert response.json()["current_ward_name"] == "General Medical Ward 1"
    assert client.get("/api/nurses/me").json()["current_ward_id"] == 102


def test_nurse_leaves_the_ward(client):
    login(client, NURSE_4)

    response = client.put("/api/nurses/me/location", json={"ward_id": None})

    assert response.json()["current_ward_id"] is None
    assert response.json()["location_at"] is None


def test_unknown_ward_is_rejected(client):
    login(client, NURSE_4)

    assert client.put("/api/nurses/me/location", json={"ward_id": 999}).status_code == 404


def test_off_shift_nurse_cannot_mark_a_location(client):
    login(client, NURSE_OFF_SHIFT)

    assert client.put("/api/nurses/me/location", json={"ward_id": 104}).status_code == 409


def test_going_off_shift_forgets_the_location(client):
    login(client, NURSE_4)
    client.put("/api/nurses/me/status", json={"status": "OffShift"})
    client.put("/api/nurses/me/status", json={"status": "Available"})

    assert client.get("/api/nurses/me").json()["current_ward_id"] is None


# --- Door badge reader (device simulator) -----------------------------------------------------

def test_door_reader_records_where_the_nurse_is(client):
    login(client, NURSE)

    assert client.post("/api/simulator/badge-scan", json={"nurse_id": "NURSE-03", "ward_id": 101}).status_code == 204

    nurses = {n["nurse_id"]: n for n in client.get("/api/simulator/nurses").json()}
    assert nurses["NURSE-03"]["current_ward_id"] == 101


@pytest.mark.parametrize("nurse_id, ward_id, code", [
    ("NURSE-99", 101, 404),   # unknown badge
    ("NURSE-03", 999, 404),   # unknown door
    ("NURSE-05", 104, 409),   # off shift
])
def test_door_reader_refuses(client, nurse_id, ward_id, code):
    login(client, NURSE)

    assert client.post("/api/simulator/badge-scan", json={"nurse_id": nurse_id, "ward_id": ward_id}).status_code == code


def test_door_reader_is_part_of_the_simulator(client, monkeypatch):
    monkeypatch.setattr(settings, "simulator_enabled", False)
    login(client, NURSE)

    assert client.post("/api/simulator/badge-scan", json={"nurse_id": "NURSE-03", "ward_id": 101}).status_code == 404


# --- Ward map --------------------------------------------------------------------------------

def ward_map(client) -> dict:
    response = client.get("/api/map")
    assert response.status_code == 200, response.text
    return response.json()


def wards_of(map_: dict) -> dict[int, dict]:
    return {w["ward_id"]: w for f in map_["floors"] for w in f["wards"]}


def test_map_shows_floors_wards_and_where_nurses_are(client):
    login(client, NURSE)
    map_ = ward_map(client)
    wards = wards_of(map_)

    assert [(f["floor"], [w["ward_id"] for w in f["wards"]]) for f in map_["floors"]] == [(1, [101, 104]), (2, [102, 103])]
    assert {n["nurse_id"] for n in wards[101]["nurses_here"]} == {"NURSE-01", "NURSE-02"}
    assert [n["nurse_id"] for n in wards[103]["nurses_here"]] == ["NURSE-03"]
    assert wards[102]["nurses_here"] == []
    assert [n["nurse_id"] for n in map_["location_unknown"]] == ["NURSE-10"]
    assert [n["nurse_id"] for n in map_["off_shift"]] == ["NURSE-05"]


def test_map_shows_status_and_open_calls(client):
    login(client, NURSE)
    here = {n["nurse_id"]: n for w in wards_of(ward_map(client)).values() for n in w["nurses_here"]}

    assert here["NURSE-02"]["status"] == "Busy"
    # ALT-1003 is escalated to NURSE-03 and not acknowledged yet
    assert here["NURSE-03"]["open_calls"] == 1


def test_map_shows_open_alerts_and_whom_they_went_to(client):
    login(client, NURSE)
    alerts = {a["alert_id"]: a for a in wards_of(ward_map(client))[101]["alerts"]}

    assert set(alerts) == {"ALT-1001", "ALT-1003"}
    assert alerts["ALT-1003"]["status"] == "ESCALATED"
    assert alerts["ALT-1003"]["escalated_to_name"] == "Madina Tulegenova"


def test_map_follows_the_door_reader(client):
    login(client, NURSE)
    client.post("/api/simulator/badge-scan", json={"nurse_id": "NURSE-04", "ward_id": 102})

    wards = wards_of(ward_map(client))

    assert "NURSE-04" not in [n["nurse_id"] for n in wards[104]["nurses_here"]]
    assert [n["nurse_id"] for n in wards[102]["nurses_here"]] == ["NURSE-04"]


def test_map_hides_an_old_location(client):
    location_seen("NURSE-03", LOCATION_FRESH_MINUTES + 5)
    login(client, NURSE)
    map_ = ward_map(client)

    assert "NURSE-03" in [n["nurse_id"] for n in map_["location_unknown"]]


def test_map_has_no_patient_data(client):
    login(client, NURSE)

    assert "patient" not in client.get("/api/map").text.lower()


@pytest.mark.parametrize("account, code", [(NURSE_3, 200), (HEAD_NURSE, 200), (ADMISSIONS, 403), (PUBLIC_STAFF, 403)])
def test_who_can_see_the_map(client, account, code):
    login(client, account)

    assert client.get("/api/map").status_code == code
