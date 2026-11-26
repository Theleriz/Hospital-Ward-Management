"""Ward assignments changed by the head nurse and their effect on alerts (T-51, tests T-58).

Rule from the task: new alerts follow the new assignments at once; alerts that were
already created stay with the nurse they were assigned to.

The assignment screen and its API are not there yet, so assignments are changed with
the database procedures of T-51 (sp_AssignWardNurse, sp_RemoveAdditionalNurse) on behalf
of the head nurse NURSE-10. Alerts, the nurse post and acknowledgement go through the API.

Seed state (db/04_seed.sql):
  ward 101: NURSE-01 primary, NURSE-02 additional
  ward 104: NURSE-04 primary, NURSE-05 additional (off shift)
  ALT-1001  CRITICAL PENDING ward 101, assigned NURSE-01
"""

import pytest

from tests.conftest import HEAD_NURSE, NURSE, NURSE_2, NURSE_3, NURSE_4, login, run_as_owner

pytestmark = pytest.mark.usefixtures("seed_data")

HEAD_NURSE_ID = "NURSE-10"


# --- Helpers ---------------------------------------------------------------------------

def assign(ward_id: int, nurse_id: str, primary: bool) -> None:
    """The head nurse assigns a nurse to a ward (primary or additional)."""
    run_as_owner(
        "CALL sp_AssignWardNurse(%s, %s, %s, %s, %s)",
        (ward_id, nurse_id, primary, HEAD_NURSE_ID, "test T-58"),
    )


def remove(ward_id: int, nurse_id: str) -> None:
    """The head nurse takes an additional nurse off a ward."""
    run_as_owner(
        "CALL sp_RemoveAdditionalNurse(%s, %s, %s, %s)",
        (ward_id, nurse_id, HEAD_NURSE_ID, "test T-58"),
    )


def raise_alert(client, ward_id: int) -> dict:
    """A new alert from the device simulator; the backend picks the ward's nurse."""
    login(client, NURSE)
    response = client.post("/api/simulator/alerts", json={
        "ward_id": ward_id, "source": "CALL_BUTTON", "priority": "HIGH"})
    assert response.status_code == 201, response.text
    return response.json()


def open_alert_ids(client, account: dict) -> set[str]:
    login(client, account)
    return {a["alert_id"] for a in client.get("/api/alerts").json()["open"]}


def assigned_nurse(client, alert_id: str) -> str | None:
    login(client, HEAD_NURSE)
    board = client.get("/api/alerts").json()
    return next(a for a in board["open"] + board["recent"] if a["alert_id"] == alert_id)["assigned_nurse_id"]


# --- New alerts follow the new assignment ---------------------------------------------------

def test_new_alert_goes_to_the_new_primary_nurse(client):
    assign(101, "NURSE-03", primary=True)

    assert raise_alert(client, 101)["assigned_nurse_id"] == "NURSE-03"


def test_simulator_shows_the_new_nurse_on_duty(client):
    assign(104, "NURSE-03", primary=True)
    login(client, NURSE)

    wards = {w["ward_id"]: w for w in client.get("/api/simulator/wards").json()}

    assert wards[104]["nurse_on_duty"] == "NURSE-03"


def test_new_alert_goes_back_after_the_primary_is_returned(client):
    assign(101, "NURSE-03", primary=True)
    assign(101, "NURSE-01", primary=True)

    assert raise_alert(client, 101)["assigned_nurse_id"] == "NURSE-01"


def test_additional_nurse_gets_the_alert_when_the_primary_is_off_shift(client):
    # NURSE-04 joins ward 101 as additional; the primary NURSE-01 goes off shift
    # and NURSE-02 (the other additional nurse) is Busy, so Available NURSE-04 is chosen
    assign(101, "NURSE-04", primary=False)
    login(client, NURSE)
    client.put("/api/nurses/me/status", json={"status": "OffShift"})

    assert raise_alert(client, 101)["assigned_nurse_id"] == "NURSE-04"


# --- Alerts that already exist stay with their nurse ----------------------------------------

def test_existing_alert_stays_with_the_old_primary(client):
    assign(101, "NURSE-03", primary=True)

    # ALT-1001 was created before the change
    assert assigned_nurse(client, "ALT-1001") == "NURSE-01"


def test_alert_raised_before_the_change_stays_and_one_after_goes_to_the_new_nurse(client):
    before = raise_alert(client, 101)["alert_id"]
    assign(101, "NURSE-03", primary=True)
    after = raise_alert(client, 101)["alert_id"]

    assert assigned_nurse(client, before) == "NURSE-01"
    assert assigned_nurse(client, after) == "NURSE-03"


def test_nurse_taken_off_the_ward_still_answers_her_or_his_alert(client):
    # NURSE-04 is the primary of ward 101 for a while and gets an alert
    assign(101, "NURSE-04", primary=True)
    alert = raise_alert(client, 101)["alert_id"]
    # Then the head nurse puts NURSE-01 back and takes NURSE-04 off the ward
    assign(101, "NURSE-01", primary=True)
    remove(101, "NURSE-04")

    # The alert is still hers or his: visible on the post and can be acknowledged
    assert alert in open_alert_ids(client, NURSE_4)
    response = client.post(f"/api/alerts/{alert}/acknowledge")
    assert response.status_code == 200
    assert response.json()["acknowledged_by_id"] == "NURSE-04"


# --- The nurse post follows the assignment --------------------------------------------------

def test_nurse_assigned_to_a_ward_sees_its_alerts(client):
    assert "ALT-1001" not in open_alert_ids(client, NURSE_4)

    assign(101, "NURSE-04", primary=False)

    assert "ALT-1001" in open_alert_ids(client, NURSE_4)


def test_nurse_assigned_to_a_ward_can_acknowledge_its_alerts(client):
    login(client, NURSE_4)
    assert client.post("/api/alerts/ALT-1001/acknowledge").status_code == 403

    assign(101, "NURSE-04", primary=False)

    response = client.post("/api/alerts/ALT-1001/acknowledge")
    assert response.status_code == 200
    assert response.json()["acknowledged_by_id"] == "NURSE-04"


def test_nurse_taken_off_a_ward_no_longer_sees_its_alerts(client):
    assert "ALT-1001" in open_alert_ids(client, NURSE_2)

    remove(101, "NURSE-02")

    assert "ALT-1001" not in open_alert_ids(client, NURSE_2)


def test_nurse_taken_off_a_ward_cannot_acknowledge_its_alerts(client):
    remove(101, "NURSE-02")
    login(client, NURSE_2)

    assert client.post("/api/alerts/ALT-1001/acknowledge").status_code == 403


def test_my_wards_on_the_post_follow_the_assignment(client):
    assign(101, "NURSE-03", primary=True)
    login(client, NURSE_3)

    wards = {w["ward_id"]: w["is_primary"] for w in client.get("/api/nurses/me").json()["wards"]}

    assert wards[101] is True
    # The previous wards stay as they were
    assert wards[102] is False and wards[103] is True
