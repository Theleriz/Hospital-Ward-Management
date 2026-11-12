"""Nurse workstation (T-24), device simulator (T-26) and escalation (T-25).

Seed state (db/04_seed.sql), open alerts:
  ALT-1001  CRITICAL  PENDING    ward 101  assigned NURSE-01, 5 minutes old (overdue)
  ALT-1003  CRITICAL  ESCALATED  ward 101  NURSE-01 -> NURSE-03
  ALT-1005  HIGH      PENDING    ward 102  assigned NURSE-02, 10 seconds old
Nurses: NURSE-01 ward 101 (primary), NURSE-02 Busy wards 101 and 102 (primary),
NURSE-03 wards 102 and 103 (primary), NURSE-04 ward 104 (primary),
NURSE-05 off shift ward 104, NURSE-10 head nurse without a ward.
"""

import pytest

from app.config import settings
from app.escalation import escalate_overdue
from tests.conftest import (
    ADMISSIONS, HEAD_NURSE, NURSE, NURSE_2, NURSE_3, NURSE_4, NURSE_OFF_SHIFT, PUBLIC_STAFF,
    login, run_as_owner,
)

pytestmark = pytest.mark.usefixtures("seed_data")


def open_ids(client) -> list[str]:
    return [a["alert_id"] for a in client.get("/api/alerts").json()["open"]]


def make_old(alert_id: str, seconds: int = 60) -> None:
    run_as_owner(
        """UPDATE "WardAlert" SET "CreatedAt" = CURRENT_TIMESTAMP - make_interval(secs => %s),
                                  "UpdatedAt" = CURRENT_TIMESTAMP
           WHERE "AlertID" = %s""",
        (seconds, alert_id),
    )


def simulate(client, **fields) -> dict:
    body = {"ward_id": 101, "patient_id": 1, "source": "MONITOR", "priority": "CRITICAL", **fields}
    response = client.post("/api/simulator/alerts", json=body)
    assert response.status_code == 201, response.text
    return response.json()


# --- Who sees which alerts -------------------------------------------------------------

def test_nurse_sees_alerts_of_own_wards(client):
    login(client, NURSE)

    assert set(open_ids(client)) == {"ALT-1001", "ALT-1003"}


def test_nurse_sees_alert_escalated_to_her_or_him(client):
    login(client, NURSE_3)

    # ALT-1003 is in ward 101, not hers or his, but was escalated to NURSE-03
    assert set(open_ids(client)) == {"ALT-1003", "ALT-1005"}


def test_head_nurse_sees_every_open_alert(client):
    login(client, HEAD_NURSE)

    board = client.get("/api/alerts").json()

    assert {a["alert_id"] for a in board["open"]} == {"ALT-1001", "ALT-1003", "ALT-1005"}
    assert not any(a["can_acknowledge"] for a in board["open"])


def test_critical_alerts_come_first(client):
    login(client, NURSE_2)

    priorities = [a["priority"] for a in client.get("/api/alerts").json()["open"]]

    assert priorities == ["CRITICAL", "CRITICAL", "HIGH"]


def test_recent_alerts_show_who_acknowledged(client):
    login(client, NURSE_2)

    recent = {a["alert_id"]: a for a in client.get("/api/alerts").json()["recent"]}

    assert recent["ALT-1002"]["acknowledged_by_id"] == "NURSE-02"
    assert recent["ALT-1002"]["acknowledged_by_name"] == "Dinara Omarova"


@pytest.mark.parametrize("account", [ADMISSIONS, PUBLIC_STAFF])
def test_other_roles_cannot_use_the_nurse_workstation(client, account):
    login(client, account)

    assert client.get("/api/alerts").status_code == 403
    assert client.post("/api/alerts/ALT-1001/acknowledge").status_code == 403
    assert client.get("/api/nurses/me").status_code == 403
    assert client.post("/api/simulator/alerts", json={"ward_id": 101, "source": "MONITOR",
                                                      "priority": "HIGH"}).status_code == 403


# --- UC-6: acknowledge -----------------------------------------------------------------

def test_acknowledge(client):
    login(client, NURSE)

    response = client.post("/api/alerts/ALT-1001/acknowledge")

    assert response.status_code == 200
    assert response.json()["status"] == "ACKNOWLEDGED"
    assert response.json()["acknowledged_by_id"] == "NURSE-01"
    assert response.json()["assigned_nurse_id"] == "NURSE-01"
    board = client.get("/api/alerts").json()
    assert "ALT-1001" not in [a["alert_id"] for a in board["open"]]
    assert "ALT-1001" in [a["alert_id"] for a in board["recent"]]


def test_acknowledge_twice(client):
    login(client, NURSE)
    client.post("/api/alerts/ALT-1001/acknowledge")

    response = client.post("/api/alerts/ALT-1001/acknowledge")

    assert response.status_code == 409
    assert "Aigerim Sadykova" in response.json()["detail"]


def test_nurse_of_another_ward_cannot_acknowledge(client):
    login(client, NURSE_4)

    assert client.post("/api/alerts/ALT-1001/acknowledge").status_code == 403


def test_off_shift_nurse_cannot_acknowledge(client):
    login(client, NURSE_OFF_SHIFT)

    response = client.post("/api/alerts/ALT-1001/acknowledge")

    assert response.status_code == 409
    assert "не на смене" in response.json()["detail"]


def test_escalation_target_can_acknowledge(client):
    login(client, NURSE_3)

    assert client.post("/api/alerts/ALT-1003/acknowledge").status_code == 200


def test_acknowledge_unknown_alert(client):
    login(client, NURSE)

    assert client.post("/api/alerts/ALT-9999/acknowledge").status_code == 404


# --- Nurse status ------------------------------------------------------------------------

def test_nurse_sees_own_wards_and_status(client):
    login(client, NURSE_2)

    me = client.get("/api/nurses/me").json()

    assert me["status"] == "Busy"
    assert [(w["ward_id"], w["is_primary"]) for w in me["wards"]] == [(101, False), (102, True)]


def test_nurse_changes_status(client):
    login(client, NURSE)

    response = client.put("/api/nurses/me/status", json={"status": "Busy"})

    assert response.status_code == 200
    assert response.json()["status"] == "Busy"


def test_off_shift_status_turns_acknowledgement_off(client):
    login(client, NURSE)
    client.put("/api/nurses/me/status", json={"status": "OffShift"})

    assert not any(a["can_acknowledge"] for a in client.get("/api/alerts").json()["open"])
    assert client.post("/api/alerts/ALT-1001/acknowledge").status_code == 409


def test_invalid_status(client):
    login(client, NURSE)

    assert client.put("/api/nurses/me/status", json={"status": "Sleeping"}).status_code == 422


# --- UC-5: device simulator ----------------------------------------------------------------

def test_simulator_lists_beds_and_nurse_on_duty(client):
    login(client, NURSE)

    wards = {w["ward_id"]: w for w in client.get("/api/simulator/wards").json()}

    assert [p["full_name"] for p in wards[101]["patients"]] == ["Akezhan Ivanov", "Elena Smirnova"]
    assert wards[101]["nurse_on_duty"] == "NURSE-01"
    assert wards[104]["patients"] == []
    assert wards[104]["nurse_on_duty"] == "NURSE-04"


def test_simulated_alert_reaches_the_ward_nurse(client):
    login(client, NURSE)

    raised = simulate(client)

    assert raised["assigned_nurse_id"] == "NURSE-01"
    alert = next(a for a in client.get("/api/alerts").json()["open"] if a["alert_id"] == raised["alert_id"])
    assert alert["patient_name"] == "Akezhan Ivanov"
    assert alert["description"] == "SpO2 упала до 84%"
    assert alert["can_acknowledge"] is True


def test_alert_goes_to_another_nurse_when_primary_is_off_shift(client):
    login(client, NURSE)
    client.put("/api/nurses/me/status", json={"status": "OffShift"})

    # NURSE-02 also works in ward 101 and is on shift (Busy)
    assert simulate(client)["assigned_nurse_id"] == "NURSE-02"


def test_alert_without_nurse_on_shift_is_unassigned(client):
    login(client, NURSE_4)
    client.put("/api/nurses/me/status", json={"status": "OffShift"})

    # Ward 104: NURSE-04 just went off shift, NURSE-05 is off shift
    raised = simulate(client, ward_id=104, patient_id=None, source="CALL_BUTTON", priority="HIGH")

    assert raised["assigned_nurse_id"] is None


def test_simulator_refuses_patient_from_another_ward(client):
    login(client, NURSE)

    response = client.post("/api/simulator/alerts", json={"ward_id": 102, "patient_id": 1,
                                                          "source": "MONITOR", "priority": "HIGH"})

    assert response.status_code == 409


def test_simulator_refuses_unknown_ward(client):
    login(client, NURSE)

    response = client.post("/api/simulator/alerts", json={"ward_id": 999, "source": "MONITOR",
                                                          "priority": "HIGH"})

    assert response.status_code == 404


def test_simulator_can_be_turned_off(client, monkeypatch):
    monkeypatch.setattr(settings, "simulator_enabled", False)
    login(client, NURSE)

    assert client.get("/api/simulator/wards").status_code == 404


# --- UC-7: escalation ------------------------------------------------------------------------

def alert_status(client, alert_id: str) -> dict:
    login(client, HEAD_NURSE)
    board = client.get("/api/alerts").json()
    return next(a for a in board["open"] + board["recent"] if a["alert_id"] == alert_id)


def test_overdue_alert_is_escalated_to_an_available_nurse(client):
    # ALT-1001 is 5 minutes old; nobody else in ward 101 is Available, so it goes to
    # NURSE-04, who works on the same floor (ward 104). ALT-1003 was escalated to
    # NURSE-03 30 minutes ago and is still not acknowledged, so it goes on as well.
    assert dict(escalate_overdue(client.app.state.pool)) == {"ALT-1001": "NURSE-04", "ALT-1003": "NURSE-04"}

    alert = alert_status(client, "ALT-1001")
    assert alert["status"] == "ESCALATED"
    assert alert["escalated_to_id"] == "NURSE-04"
    assert alert["assigned_nurse_id"] == "NURSE-01"


def test_escalation_prefers_a_nurse_of_the_same_ward(client):
    login(client, NURSE_2)
    raised = simulate(client, ward_id=102, patient_id=3, priority="HIGH")
    make_old(raised["alert_id"])

    escalated = dict(escalate_overdue(client.app.state.pool))

    # NURSE-02 got the alert; NURSE-03 also works in ward 102 and is Available
    assert escalated[raised["alert_id"]] == "NURSE-03"


def test_fresh_and_low_alerts_are_not_escalated(client):
    login(client, NURSE)
    low = simulate(client, priority="LOW")
    make_old(low["alert_id"])
    fresh = simulate(client, priority="CRITICAL")

    escalated = dict(escalate_overdue(client.app.state.pool))

    assert low["alert_id"] not in escalated
    assert fresh["alert_id"] not in escalated
    assert "ALT-1005" not in escalated


def test_no_escalation_when_nobody_is_available(client):
    run_as_owner("""UPDATE "Nurse" SET "Status" = 'Busy' WHERE "Status" = 'Available'""")

    assert escalate_overdue(client.app.state.pool) == []
    assert alert_status(client, "ALT-1001")["status"] == "PENDING"


def test_no_repeat_escalation_within_30_seconds(client):
    escalate_overdue(client.app.state.pool)

    # The nurses who just received the alerts have 30 seconds to acknowledge them
    assert escalate_overdue(client.app.state.pool) == []
