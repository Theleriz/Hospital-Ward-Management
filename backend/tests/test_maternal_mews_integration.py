"""Authenticated maternal MEWS API checks on the dedicated fictional-data DB."""

from datetime import datetime, timedelta, timezone

import psycopg

from app.routers import simulator
from conftest import ADMIN_URL, NURSE, login


NOW = datetime(2026, 11, 25, 12, 0, tzinfo=timezone.utc)


def body(**changes):
    result = {
        "patient_id": 1,
        "maternal_status": "PREGNANT",
        "status_confirmed": True,
        "delivery_at": None,
        "respiratory_rate": 18,
        "spo2": 98,
        "temperature": 36.6,
        "heart_rate": 90,
        "systolic": 115,
        "diastolic": 75,
        "measurements_confirmed": True,
        "additional_concerns_confirmed": True,
        "additional_concerns": [],
    }
    result.update(changes)
    return result


def counts():
    with psycopg.connect(ADMIN_URL) as conn:
        requests = conn.execute('SELECT count(*) FROM "StaffReviewRequest"').fetchone()[0]
        alerts = conn.execute('SELECT count(*) FROM "WardAlert"').fetchone()[0]
    return requests, alerts


def test_explicit_pregnancy_is_assessed_without_gender_or_ward_inference(client, seed_data):
    login(client, NURSE)
    before = counts()

    # Seed patient 1 is recorded as Male and is in an Intensive Care ward.
    # Explicit maternal confirmation still drives applicability; neither field does.
    response = client.post("/api/simulator/assess-maternal-mews", json=body())

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "CLASSIFIED"
    assert response.json()["score"] == 0
    assert response.json()["pulse_rule"] == "ANTENATAL"
    assert counts() == before


def test_endpoint_uses_server_time_for_48_hour_and_four_week_boundaries(client, seed_data, monkeypatch):
    login(client, NURSE)
    monkeypatch.setattr(simulator, "maternal_mews_now", lambda: NOW)

    just_before_48h = client.post("/api/simulator/assess-maternal-mews", json=body(
        maternal_status="POSTPARTUM",
        delivery_at=(NOW - timedelta(hours=48) + timedelta(microseconds=1)).isoformat(),
        heart_rate=60,
    ))
    at_48h = client.post("/api/simulator/assess-maternal-mews", json=body(
        maternal_status="POSTPARTUM",
        delivery_at=(NOW - timedelta(hours=48)).isoformat(),
        heart_rate=60,
    ))
    at_four_weeks = client.post("/api/simulator/assess-maternal-mews", json=body(
        maternal_status="POSTPARTUM",
        delivery_at=(NOW - timedelta(days=28)).isoformat(),
    ))
    after_four_weeks = client.post("/api/simulator/assess-maternal-mews", json=body(
        maternal_status="POSTPARTUM",
        delivery_at=(NOW - timedelta(days=28, microseconds=1)).isoformat(),
    ))

    assert just_before_48h.status_code == at_48h.status_code == 200
    assert (just_before_48h.json()["pulse_rule"],
            just_before_48h.json()["component_scores"]["heart_rate"]) == ("POSTPARTUM_UNDER_48H", 2)
    assert (at_48h.json()["pulse_rule"], at_48h.json()["component_scores"]["heart_rate"]) == (
        "POSTPARTUM_48H_PLUS", 1,
    )
    assert at_four_weeks.json()["status"] == "CLASSIFIED"
    assert after_four_weeks.json()["status"] == "REVIEW_REQUIRED"
    assert after_four_weeks.json()["score"] is None


def test_missing_or_unconfirmed_data_returns_review_without_creating_request_or_alert(client, seed_data):
    login(client, NURSE)
    before = counts()

    missing_status = client.post("/api/simulator/assess-maternal-mews", json=body(
        maternal_status=None, status_confirmed=False,
    ))
    missing_measurement = client.post("/api/simulator/assess-maternal-mews", json=body(
        respiratory_rate=None,
    ))
    unconfirmed_measurements = client.post("/api/simulator/assess-maternal-mews", json=body(
        measurements_confirmed=False,
    ))
    contradictory = client.post("/api/simulator/assess-maternal-mews", json=body(
        delivery_at=(NOW - timedelta(days=1)).isoformat(),
    ))

    for response in (missing_status, missing_measurement, unconfirmed_measurements, contradictory):
        assert response.status_code == 200, response.text
        assert response.json()["status"] == "REVIEW_REQUIRED"
        assert response.json()["score"] is None
    assert counts() == before
