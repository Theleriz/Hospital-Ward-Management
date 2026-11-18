"""Head nurse report (T-27, UC-8): alert history, response times, escalations.

Seed alerts (db/04_seed.sql), relative to the time of seeding:
  ALT-1001  CRITICAL  PENDING       ward 101  assigned NURSE-01, 5 min ago
  ALT-1002  HIGH      ACKNOWLEDGED  ward 102  NURSE-02 after 12 s, 15 min ago
  ALT-1003  CRITICAL  ESCALATED     ward 101  NURSE-01 -> NURSE-03, 30 min ago
  ALT-1004  LOW       ACKNOWLEDGED  ward 102  NURSE-03 after 45 s, 1 h ago
  ALT-1005  HIGH      PENDING       ward 102  assigned NURSE-02, 10 s ago
  ALT-1006  HIGH      ACKNOWLEDGED  ward 101  NURSE-01 -> NURSE-04, acknowledged by NURSE-04 after 50 s, 2 h ago
"""

import pytest

from tests.conftest import ADMISSIONS, HEAD_NURSE, NURSE, PUBLIC_STAFF, login

pytestmark = pytest.mark.usefixtures("seed_data")

REPORT = "/api/reports/alerts"


def report(client, **params) -> dict:
    response = client.get(REPORT, params=params)
    assert response.status_code == 200, response.text
    return response.json()


# --- Access (FR-31) ----------------------------------------------------------------------

def test_report_requires_login(client):
    assert client.get(REPORT).status_code == 401
    assert client.get(f"{REPORT}/ALT-1002/events").status_code == 401


@pytest.mark.parametrize("account", [NURSE, ADMISSIONS, PUBLIC_STAFF])
def test_only_head_nurse_sees_the_report(client, account):
    login(client, account)

    assert client.get(REPORT).status_code == 403
    assert client.get(f"{REPORT}/ALT-1002/events").status_code == 403


def test_head_nurse_keeps_the_nurse_workstation(client):
    # The new database role inherits every nurse right
    login(client, HEAD_NURSE)

    assert client.get("/api/alerts").status_code == 200
    assert client.put("/api/nurses/me/status", json={"status": "Busy"}).json()["status"] == "Busy"


# --- Numbers (FR-28 to FR-30) --------------------------------------------------------------

def test_summary_counts_and_response_times(client):
    login(client, HEAD_NURSE)

    data = report(client)

    assert data["hours"] == 24
    assert data["target_seconds"] == 30
    assert data["summary"] == {
        "total": 6,
        "acknowledged": 3,
        "open": 3,
        "escalated": 2,
        # (12 + 45 + 50) / 3, response time = acknowledgement - creation (FR-29)
        "avg_response_seconds": 35.7,
        "median_response_seconds": 45.0,
        "max_response_seconds": 50.0,
        "within_target": 1,
    }


def test_by_priority_lists_every_priority(client):
    login(client, HEAD_NURSE)

    rows = {r["priority"]: r for r in report(client)["by_priority"]}

    assert list(rows) == ["CRITICAL", "HIGH", "LOW"]
    assert rows["CRITICAL"] == {
        "priority": "CRITICAL", "total": 2, "acknowledged": 0, "escalated": 1, "avg_response_seconds": None,
    }
    assert rows["HIGH"] == {
        "priority": "HIGH", "total": 3, "acknowledged": 2, "escalated": 1, "avg_response_seconds": 31.0,
    }
    assert rows["LOW"]["escalated"] == 0


def test_by_nurse_shows_who_answered_and_who_missed(client):
    login(client, HEAD_NURSE)

    rows = {r["nurse_id"]: r for r in report(client)["by_nurse"]}

    assert set(rows) == {"NURSE-01", "NURSE-02", "NURSE-03", "NURSE-04"}
    # Two of NURSE-01's alerts went to other nurses after 30 s
    assert rows["NURSE-01"]["assigned"] == 3
    assert rows["NURSE-01"]["acknowledged"] == 0
    assert rows["NURSE-01"]["escalated_away"] == 2
    assert rows["NURSE-04"]["received_escalations"] == 1
    assert rows["NURSE-04"]["acknowledged"] == 1
    assert rows["NURSE-04"]["avg_response_seconds"] == 50.0
    assert rows["NURSE-02"]["avg_response_seconds"] == 12.0


def test_history_is_newest_first_with_response_time(client):
    login(client, HEAD_NURSE)

    data = report(client)
    alerts = {a["alert_id"]: a for a in data["alerts"]}

    assert [a["alert_id"] for a in data["alerts"]] == [
        "ALT-1005", "ALT-1001", "ALT-1002", "ALT-1003", "ALT-1004", "ALT-1006",
    ]
    assert data["alerts_truncated"] is False
    assert alerts["ALT-1006"]["response_seconds"] == 50.0
    assert alerts["ALT-1006"]["was_escalated"] is True
    assert alerts["ALT-1006"]["escalated_to_name"] == "Aliya Nurlanova"
    assert alerts["ALT-1001"]["response_seconds"] is None


def test_report_has_no_patient_data(client):
    login(client, HEAD_NURSE)

    alert = report(client)["alerts"][0]

    assert not any("patient" in key for key in alert)


def test_period_limits_the_report(client):
    login(client, HEAD_NURSE)

    data = report(client, hours=1)

    # ALT-1004 (1 hour old) and ALT-1006 (2 hours old) are outside the last hour
    assert {a["alert_id"] for a in data["alerts"]} == {"ALT-1001", "ALT-1002", "ALT-1003", "ALT-1005"}
    assert data["summary"]["total"] == 4
    assert data["summary"]["escalated"] == 1


def test_acknowledgement_appears_in_the_report(client):
    login(client, NURSE)
    assert client.post("/api/alerts/ALT-1001/acknowledge").status_code == 200
    client.post("/api/auth/logout")

    login(client, HEAD_NURSE)
    alerts = {a["alert_id"]: a for a in report(client)["alerts"]}

    assert alerts["ALT-1001"]["status"] == "ACKNOWLEDGED"
    assert alerts["ALT-1001"]["acknowledged_by_id"] == "NURSE-01"
    # Created 5 minutes before seeding
    assert alerts["ALT-1001"]["response_seconds"] >= 300


@pytest.mark.parametrize("hours", [0, -1, 721, "day"])
def test_invalid_period_is_rejected(client, hours):
    login(client, HEAD_NURSE)

    assert client.get(REPORT, params={"hours": hours}).status_code == 422


# --- Journal of one alert (BR-08) -------------------------------------------------------------

def test_journal_of_an_escalated_alert(client):
    login(client, HEAD_NURSE)

    response = client.get(f"{REPORT}/ALT-1006/events")

    assert response.status_code == 200
    events = [(e["event_type"], e["nurse_id"]) for e in response.json()]
    assert events == [
        ("CREATED", None),
        ("ASSIGNED", "NURSE-01"),
        ("ESCALATED", "NURSE-04"),
        ("ACKNOWLEDGED", "NURSE-04"),
    ]
    assert response.json()[3]["nurse_name"] == "Aliya Nurlanova"


def test_journal_of_unknown_alert(client):
    login(client, HEAD_NURSE)

    assert client.get(f"{REPORT}/ALT-9999/events").status_code == 404
