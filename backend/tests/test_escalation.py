"""UC-7 escalation: who receives an overdue alert (T-28, NFR-02, decisions.md record 9).

The rules of sp_EscalateAlert itself are covered by db/tests/test_hospital_ward.sql;
these tests check whom the backend escalation round picks in realistic situations.

"On duty" = nurse status Available or Busy; "free" = Available (db/01_schema.sql).

Seed state (db/04_seed.sql):
  Wards:  101 floor 1, 104 floor 1, 102 floor 2, 103 floor 2
  NURSE-01  Available  ward 101 (primary)
  NURSE-02  Busy       wards 101, 102 (primary)
  NURSE-03  Available  wards 102, 103 (primary)
  NURSE-04  Available  ward 104 (primary)
  NURSE-05  OffShift   ward 104
  NURSE-10  Available  head nurse, no ward
  ALT-1001  CRITICAL PENDING ward 101, assigned NURSE-01, 5 minutes old (overdue)
  ALT-1003  CRITICAL ESCALATED ward 101, NURSE-01 -> NURSE-03 30 minutes ago (overdue again)

Order of choice: a nurse of the alert's ward, then one working on the same floor, then anyone.
"""

import psycopg
import pytest

from app.escalation import escalate_overdue
from tests.conftest import (
    ADMIN_URL, NURSE, NURSE_2, NURSE_3, NURSE_4, login, run_as_owner,
)

pytestmark = pytest.mark.usefixtures("seed_data")


# --- Helpers ---------------------------------------------------------------------------

def fetch_all(sql: str, params=None) -> list[tuple]:
    with psycopg.connect(ADMIN_URL, autocommit=True) as conn:
        return conn.execute(sql, params).fetchall()


def make_old(alert_id: str, seconds: int) -> None:
    run_as_owner(
        """UPDATE "WardAlert" SET "CreatedAt" = CURRENT_TIMESTAMP - make_interval(secs => %s),
                                  "UpdatedAt" = CURRENT_TIMESTAMP
           WHERE "AlertID" = %s""",
        (seconds, alert_id),
    )


def set_status(nurse_ids: list[str], status: str) -> None:
    run_as_owner('UPDATE "Nurse" SET "Status" = %s WHERE "NurseID" = ANY(%s)', (status, nurse_ids))


def raise_alert(client, account: dict, **fields) -> dict:
    login(client, account)
    body = {"ward_id": 101, "patient_id": 1, "source": "MONITOR", "priority": "HIGH", **fields}
    response = client.post("/api/simulator/alerts", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def escalate(client) -> dict[str, str]:
    return dict(escalate_overdue(client.app.state.pool))


def journal(alert_id: str) -> list[tuple[str, str | None]]:
    return fetch_all(
        """SELECT "EventType", "NurseID" FROM "AlertEvent"
           WHERE "AlertID" = %s ORDER BY "OccurredAt", "EventID" """,
        (alert_id,),
    )


# --- NFR-02: the 30 second limit -------------------------------------------------------

@pytest.mark.parametrize("age_seconds, escalated", [(28, False), (31, True)])
def test_escalation_starts_after_30_seconds(client, age_seconds, escalated):
    alert = raise_alert(client, NURSE)
    make_old(alert["alert_id"], age_seconds)

    assert (alert["alert_id"] in escalate(client)) is escalated


@pytest.mark.parametrize("priority, escalated", [("LOW", False), ("HIGH", True), ("CRITICAL", True)])
def test_only_high_and_critical_alerts_are_escalated(client, priority, escalated):
    alert = raise_alert(client, NURSE, priority=priority)
    make_old(alert["alert_id"], 60)

    assert (alert["alert_id"] in escalate(client)) is escalated


def test_acknowledged_alert_is_not_escalated(client):
    login(client, NURSE)
    assert client.post("/api/alerts/ALT-1001/acknowledge").status_code == 200

    assert "ALT-1001" not in escalate(client)


# --- Who is on duty and who is free ----------------------------------------------------

def test_busy_and_off_shift_nurses_never_receive_an_escalation(client):
    # Only NURSE-04 stays free; NURSE-02 works in ward 101 but is Busy, NURSE-05 is off shift
    set_status(["NURSE-03", "NURSE-10"], "Busy")

    assert escalate(client)["ALT-1001"] == "NURSE-04"


def test_nurse_who_ends_her_or_his_shift_is_skipped(client):
    # NURSE-04 would get ALT-1001 (same floor), but goes off shift
    login(client, NURSE_4)
    client.put("/api/nurses/me/status", json={"status": "OffShift"})

    target = escalate(client)["ALT-1001"]

    assert target != "NURSE-04"
    assert fetch_all('SELECT "Status" FROM "Nurse" WHERE "NurseID" = %s', (target,)) == [("Available",)]


def test_nurse_of_the_ward_who_becomes_free_is_preferred(client):
    # NURSE-02 also works in ward 101; once Available she or he goes before other wards
    login(client, NURSE_2)
    client.put("/api/nurses/me/status", json={"status": "Available"})

    assert escalate(client)["ALT-1001"] == "NURSE-02"


def test_alert_never_goes_back_to_the_assigned_nurse(client):
    # NURSE-01 (assigned to ALT-1001) is the only free nurse
    set_status(["NURSE-03", "NURSE-04", "NURSE-10"], "Busy")

    assert "ALT-1001" not in escalate(client)
    assert fetch_all('SELECT "Status" FROM "WardAlert" WHERE "AlertID" = %s', ("ALT-1001",)) == [("PENDING",)]


def test_alert_without_a_nurse_on_shift_is_escalated_to_a_free_nurse(client):
    # Ward 104: NURSE-04 goes off shift, NURSE-05 is off shift, so nobody gets the alert
    login(client, NURSE_4)
    client.put("/api/nurses/me/status", json={"status": "OffShift"})
    alert = raise_alert(client, NURSE_4, ward_id=104, patient_id=None, source="CALL_BUTTON")
    assert alert["assigned_nurse_id"] is None
    make_old(alert["alert_id"], 60)

    assert escalate(client)[alert["alert_id"]] == "NURSE-01"


# --- After the escalation ----------------------------------------------------------------

def test_escalation_is_written_to_the_journal(client):
    escalate(client)

    assert journal("ALT-1001")[-1] == ("ESCALATED", "NURSE-04")


def test_escalated_alert_is_acknowledged_by_the_new_nurse(client):
    escalate(client)
    login(client, NURSE_4)

    response = client.post("/api/alerts/ALT-1001/acknowledge")

    assert response.status_code == 200
    body = response.json()
    assert body["acknowledged_by_id"] == "NURSE-04"
    # The original assignment is kept, so the escalation path can be reconstructed
    assert body["assigned_nurse_id"] == "NURSE-01"
    assert body["escalated_to_id"] == "NURSE-04"
    assert [e for e, _ in journal("ALT-1001")][-2:] == ["ESCALATED", "ACKNOWLEDGED"]


# --- Same floor and repeat escalation (decisions.md, record 9) -----------------------------

def test_escalation_prefers_a_nurse_on_the_same_floor(client):
    # Ward 101 is on floor 1; NURSE-04 (ward 104) is on floor 1, NURSE-03 on floor 2
    assert escalate(client)["ALT-1001"] == "NURSE-04"


def test_nurse_of_another_floor_gets_the_alert_when_the_floor_is_busy(client):
    set_status(["NURSE-04"], "Busy")

    assert escalate(client)["ALT-1001"] == "NURSE-03"


def test_escalated_alert_without_answer_goes_to_the_next_nurse(client):
    alert = raise_alert(client, NURSE)
    make_old(alert["alert_id"], 120)
    first = escalate(client)[alert["alert_id"]]
    # The nurse it was escalated to has not answered for 40 seconds either
    run_as_owner(
        """UPDATE "WardAlert" SET "EscalatedAt" = "CreatedAt" + INTERVAL '40 seconds'
           WHERE "AlertID" = %s""",
        (alert["alert_id"],),
    )

    second = escalate(client).get(alert["alert_id"])

    assert second not in (None, "NURSE-01", first)
    # Both escalations stay in the journal
    assert [n for e, n in journal(alert["alert_id"]) if e == "ESCALATED"] == [first, second]


def test_escalated_alert_is_not_escalated_again_within_30_seconds(client):
    alert = raise_alert(client, NURSE)
    make_old(alert["alert_id"], 120)
    escalate(client)

    assert alert["alert_id"] not in escalate(client)


def test_repeat_escalation_needs_another_free_nurse(client):
    # ALT-1003: assigned NURSE-01, escalated to NURSE-03; nobody else is free
    set_status(["NURSE-04", "NURSE-10"], "Busy")

    assert "ALT-1003" not in escalate(client)
    assert fetch_all(
        'SELECT "Status", "EscalatedToNurseID" FROM "WardAlert" WHERE "AlertID" = %s', ("ALT-1003",)
    ) == [("ESCALATED", "NURSE-03")]
