"""NEWS2 adapter/router checks with synthetic identities and a DB creation spy.

No database is used here. See test_news2_live.py for real login checks.
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.middleware.sessions import SessionMiddleware

from app.auth import Role, User, current_user
from app.priority_rules import assess_news2_vitals
from app.routers import simulator


BODY = dict(mode="NEWS2", spo2=84, heart_rate=135, systolic=120, diastolic=80,
            respiratory_rate=16, temperature=36.6, measurement_confirmed=True,
            patient_at_rest=False, acute_symptoms=False, age_years=30, pregnant=False,
            consciousness="ALERT", supplemental_oxygen=True, spo2_scale=1, scale2_confirmed=False)


def assess(**changes):
    values = {**BODY, **changes}
    values.pop("mode")
    return assess_news2_vitals(**values)


@pytest.fixture
def api(monkeypatch):
    monkeypatch.setattr(simulator.settings, "simulator_enabled", True)
    app = FastAPI()
    app.add_middleware(SessionMiddleware, secret_key="isolated-news2-checks")
    app.include_router(simulator.router)
    with TestClient(app) as client:
        yield app, client


def role(app, value):
    app.dependency_overrides[current_user] = lambda: User(
        account_id="SYNTHETIC", full_name="Synthetic user", role=value)


@pytest.mark.parametrize("changes", [
    {"measurement_confirmed": False}, {"age_years": None}, {"pregnant": None},
    {"age_years": 17}, {"pregnant": True}, {"consciousness": None},
    {"supplemental_oxygen": None}, {"spo2_scale": 2},
])
def test_news2_context_requires_review(changes):
    result = assess(**changes)
    assert result["status"] == "REVIEW_REQUIRED"
    assert result["priority"] is None
    assert result["news2_score"] is None
    assert result["reason"]


def test_news2_adapter_scores_complete_context():
    result = assess()
    assert (result["status"], result["news2_score"], result["priority"]) == ("CLASSIFIED", 8, "CRITICAL")
    assert result["classification_basis"] == "NEWS2"
    assert result["measurements"]["diastolic"] == 80
    assert "diastolic" not in result["component_scores"]


@pytest.mark.parametrize("changes", [{}, {"age_years": None}, {"measurement_confirmed": False}, {"pregnant": True}])
def test_acute_concern_is_separate_from_news2_score(changes):
    result = assess(acute_symptoms=True, **changes)
    assert result["priority"] == "CRITICAL"
    assert result["news2_score"] is None
    assert result["classification_basis"] == "ACUTE_SYMPTOMS_OVERRIDE"


@pytest.mark.parametrize("value", [Role.NURSE, Role.HEAD_NURSE])
def test_news2_assessment_roles(api, value):
    app, client = api
    role(app, value)
    response = client.post("/api/simulator/assess-vitals", json=BODY)
    assert response.status_code == 200
    assert response.json()["news2_score"] == 8


def test_news2_anonymous_request_is_401(api):
    assert api[1].post("/api/simulator/assess-vitals", json={}).status_code == 401


@pytest.mark.parametrize("value", [Role.PUBLIC_STAFF, Role.ADMISSIONS])
def test_news2_other_roles_are_403(api, value):
    app, client = api
    role(app, value)
    assert client.post("/api/simulator/assess-vitals", json={}).status_code == 403


def test_news2_disabled_simulator_is_404(api, monkeypatch):
    app, client = api
    role(app, Role.NURSE)
    monkeypatch.setattr(simulator.settings, "simulator_enabled", False)
    assert client.post("/api/simulator/assess-vitals", json=BODY).status_code == 404


@pytest.mark.parametrize("changes", [
    {"spo2": True}, {"spo2": "84"}, {"spo2": 101}, {"spo2": 95.5},
    {"diastolic": 121}, {"diastolic": 80.5}, {"temperature": 36.65},
    {"measurement_confirmed": "true"}, {"pregnant": "false"},
    {"supplemental_oxygen": 1}, {"age_years": True}, {"age_years": 30.5},
    {"consciousness": "UNKNOWN"}, {"spo2_scale": True}, {"spo2_scale": 1.0},
    {"spo2_scale": 3}, {"scale2_confirmed": "true"}, {"priority": "LOW"}, {"news2_score": 0},
])
def test_news2_invalid_payload_is_422(api, changes):
    app, client = api
    role(app, Role.NURSE)
    assert client.post("/api/simulator/assess-vitals", json={**BODY, **changes}).status_code == 422


def test_news2_omitted_context_is_not_assumed_normal(api):
    app, client = api
    role(app, Role.NURSE)
    body = {k: v for k, v in BODY.items() if k not in ("age_years", "pregnant", "consciousness", "supplemental_oxygen")}
    response = client.post("/api/simulator/assess-vitals", json=body)
    assert response.status_code == 200
    assert response.json()["status"] == "REVIEW_REQUIRED"
    assert response.json()["priority"] is None


def test_existing_demo_contract_is_preserved(api):
    app, client = api
    role(app, Role.NURSE)
    original = {k: v for k, v in BODY.items() if k in (
        "spo2", "heart_rate", "systolic", "diastolic", "respiratory_rate", "temperature",
        "measurement_confirmed", "patient_at_rest", "acute_symptoms")}
    original.update(heart_rate=75, patient_at_rest=True)
    response = client.post("/api/simulator/assess-vitals", json=original)
    assert response.status_code == 200
    assert response.json()["priority"] == "CRITICAL"
    assert "EM-01" in response.json()["reason"]
    assert "news2_score" not in response.json()


@pytest.fixture
def creation(api, monkeypatch):
    app, client = api
    calls = []
    app.dependency_overrides[simulator.service_db] = lambda: object()
    def create(body, conn):
        calls.append(body)
        return simulator.RaisedAlert(alert_id="ALT-SYNTHETIC", assigned_nurse_id="NURSE-01")
    monkeypatch.setattr(simulator, "raise_alert", create)
    return app, client, calls


def test_news2_creation_recalculates_and_reuses_existing_path(creation):
    app, client, calls = creation
    role(app, Role.NURSE)
    response = client.post("/api/simulator/alerts/from-vitals",
                           json={"ward_id": 101, "patient_id": 1, "vitals": BODY})
    assert response.status_code == 201
    assert response.json()["assessment"]["news2_score"] == 8
    assert len(calls) == 1
    assert calls[0].priority == "CRITICAL"
    assert calls[0].source == "MONITOR"
    assert calls[0].ward_id == 101
    assert calls[0].patient_id == 1
    assert "score=8" in calls[0].description
    assert "O2=1" in calls[0].description
    assert len(calls[0].description) <= 200


def test_news2_creation_blocks_incomplete_assessment(creation):
    app, client, calls = creation
    role(app, Role.NURSE)
    response = client.post("/api/simulator/alerts/from-vitals",
                           json={"ward_id": 101, "vitals": {**BODY, "measurement_confirmed": False}})
    assert response.status_code == 409
    assert calls == []


@pytest.mark.parametrize("location", ["top", "nested"])
def test_news2_creation_rejects_client_priority(creation, location):
    app, client, calls = creation
    role(app, Role.NURSE)
    body = {"ward_id": 101, "vitals": dict(BODY)}
    (body if location == "top" else body["vitals"])["priority"] = "LOW"
    assert client.post("/api/simulator/alerts/from-vitals", json=body).status_code == 422
    assert calls == []


def test_news2_creation_rejects_legacy_mode(creation):
    app, client, calls = creation
    role(app, Role.NURSE)
    assert client.post("/api/simulator/alerts/from-vitals",
                       json={"ward_id": 101, "vitals": {**BODY, "mode": "DEMO"}}).status_code == 422
    assert calls == []


def test_news2_concern_creates_explicit_override(creation):
    app, client, calls = creation
    role(app, Role.NURSE)
    response = client.post("/api/simulator/alerts/from-vitals",
                           json={"ward_id": 101, "vitals": {**BODY, "acute_symptoms": True}})
    assert response.status_code == 201
    assert response.json()["assessment"]["news2_score"] is None
    assert "override" in calls[0].description


@pytest.mark.parametrize("value,expected", [(None, 401), (Role.PUBLIC_STAFF, 403), (Role.ADMISSIONS, 403)])
def test_news2_creation_access(creation, value, expected):
    app, client, calls = creation
    if value is not None:
        role(app, value)
    assert client.post("/api/simulator/alerts/from-vitals",
                       json={"ward_id": 101, "vitals": BODY}).status_code == expected
    assert calls == []
