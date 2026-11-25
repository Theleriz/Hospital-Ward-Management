"""Real badge/PIN and NEWS2 assessment checks; uses the existing PostgreSQL.

Does not reset seed data or create alerts. Uses the original project fixtures.
"""
from tests.conftest import NURSE, PUBLIC_STAFF, login

BODY = dict(mode="NEWS2", spo2=84, heart_rate=135, systolic=120, diastolic=80,
            respiratory_rate=16, temperature=36.6, measurement_confirmed=True,
            patient_at_rest=False, acute_symptoms=False, age_years=30, pregnant=False,
            consciousness="ALERT", supplemental_oxygen=True, spo2_scale=1, scale2_confirmed=False)

def test_news2_live_assessment(client):
    login(client, NURSE)
    response = client.post("/api/simulator/assess-vitals", json=BODY)
    assert response.status_code == 200
    assert response.json()["news2_score"] == 8
    assert response.json()["priority"] == "CRITICAL"

def test_news2_live_requires_login(client):
    assert client.post("/api/simulator/assess-vitals", json={}).status_code == 401

def test_news2_live_public_staff_denied(client):
    login(client, PUBLIC_STAFF)
    assert client.post("/api/simulator/assess-vitals", json=BODY).status_code == 403

def test_news2_live_invalid_values(client):
    login(client, NURSE)
    assert client.post("/api/simulator/assess-vitals", json={**BODY, "spo2": 101}).status_code == 422
