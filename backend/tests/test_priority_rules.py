
"""Tests for automatic demo event priority classification."""

import pytest

from app.priority_rules import classify_priority


@pytest.mark.parametrize(
    "event_type, expected_priority",
    [
        ("LOW_OXYGEN", "CRITICAL"),
        ("FAST_HEART_RATE", "HIGH"),
        ("WEAK_SENSOR_SIGNAL", "LOW"),
        ("CHEST_PAIN", "CRITICAL"),
        ("PATIENT_CALL", "HIGH"),
        ("WATER_REQUEST", "LOW"),
    ],
)
def test_known_event_priority(event_type, expected_priority):
    result = classify_priority(event_type)

    assert result["priority"] == expected_priority
    assert result["description"]


def test_unknown_event_requires_review():
    with pytest.raises(ValueError, match="Unknown event"):
        classify_priority("UNKNOWN")


def test_empty_event_is_rejected():
    with pytest.raises(ValueError):
        classify_priority("")


# --- Patient vital signs validation ----------------------------

from app.priority_rules import validate_vitals


def test_valid_vitals():
    result = validate_vitals(98, 75, 120, 80, 16, 36.6)

    assert result["spo2"] == 98
    assert result["heart_rate"] == 75
    assert result["temperature"] == 36.6


@pytest.mark.parametrize(
    "values",
    [
        (105, 75, 120, 80, 16, 36.6),   # Invalid SpO2
        (98, -5, 120, 80, 16, 36.6),    # Negative heart rate
        (98, 75, 80, 120, 16, 36.6),    # Diastolic >= systolic
        (98, 75, 120, 80, 0, 36.6),     # Invalid breathing rate
        (98, 75, 120, 80, 16, 50),      # Invalid temperature
        (None, 75, 120, 80, 16, 36.6),  # Missing SpO2
        (98, "fast", 120, 80, 16, 36.6), # Invalid type
    ],
)

def test_invalid_vitals(values):
    with pytest.raises(ValueError):
        validate_vitals(*values)


from app.priority_rules import classify_vitals


def test_vitals_require_review_without_approved_rules():
    result = classify_vitals(98, 75, 120, 80, 16, 36.6)

    assert result["priority"] is None
    assert result["status"] == "REVIEW_REQUIRED"
    assert result["measurements"]["spo2"] == 98


# --- EM-01: Confirmed low oxygen demo scenario --------------------

def test_confirmed_spo2_demo_is_critical():
    result = classify_vitals(
        84, 75, 120, 80, 16, 36.6,
        measurement_confirmed=True
    )

    assert result["priority"] == "CRITICAL"
    assert result["status"] == "CLASSIFIED"
    assert "EM-01" in result["reason"]


def test_unconfirmed_spo2_requires_review():
    result = classify_vitals(
        84, 75, 120, 80, 16, 36.6,
        measurement_confirmed=False
    )

    assert result["priority"] is None
    assert result["status"] == "REVIEW_REQUIRED"


def test_other_spo2_values_are_not_classified_yet():
    result = classify_vitals(
        95, 75, 120, 80, 16, 36.6,
        measurement_confirmed=True
    )

    assert result["priority"] is None
    assert result["status"] == "REVIEW_REQUIRED"


# --- EM-02: Resting heart rate demo scenario --------------------

def test_confirmed_resting_heart_rate_is_high():
    result = classify_vitals(
        98, 135, 120, 80, 16, 36.6,
        measurement_confirmed=True,
        patient_at_rest=True
    )
    assert result["priority"] == "HIGH"
    assert result["status"] == "CLASSIFIED"
    assert "EM-02" in result["reason"]


def test_heart_rate_without_rest_confirmation_requires_review():
    result = classify_vitals(
        98, 135, 120, 80, 16, 36.6,
        measurement_confirmed=True
    )
    assert result["status"] == "REVIEW_REQUIRED"


def test_heart_rate_with_acute_symptoms_requires_review():
    result = classify_vitals(
        98, 135, 120, 80, 16, 36.6,
        measurement_confirmed=True,
        patient_at_rest=True,
        acute_symptoms=True
    )
    assert result["status"] == "REVIEW_REQUIRED"
    assert result["priority"] is None


# --- Combined scenarios and reliability --------------------

def test_critical_takes_priority_over_high():
    result = classify_vitals(
        84, 135, 120, 80, 16, 36.6,
        measurement_confirmed=True,
        patient_at_rest=True
    )
    assert result["priority"] == "CRITICAL"
    assert "EM-01" in result["reason"]
    assert "EM-02" in result["reason"]


def test_unconfirmed_combined_measurements_require_review():
    result = classify_vitals(
        84, 135, 120, 80, 16, 36.6,
        measurement_confirmed=False,
        patient_at_rest=True
    )
    assert result["status"] == "REVIEW_REQUIRED"
    assert result["priority"] is None


def test_normal_demo_values_are_not_assumed_safe():
    result = classify_vitals(
        98, 75, 120, 80, 16, 36.6,
        measurement_confirmed=True,
        patient_at_rest=True
    )
    assert result["status"] == "REVIEW_REQUIRED"
    assert result["priority"] is None


# --- Emergency Priority Detection API --------------------

from tests.conftest import NURSE, PUBLIC_STAFF, login


def test_assess_vitals_api(client):
    login(client, NURSE)

    response = client.post(
        "/api/simulator/assess-vitals",
        json={
            "spo2": 84,
            "heart_rate": 75,
            "systolic": 120,
            "diastolic": 80,
            "respiratory_rate": 16,
            "temperature": 36.6,
            "measurement_confirmed": True,
            "patient_at_rest": True,
            "acute_symptoms": False,
        },
    )

    assert response.status_code == 200
    assert response.json()["priority"] == "CRITICAL"
    assert response.json()["status"] == "CLASSIFIED"


def test_assess_vitals_requires_login(client):
    response = client.post(
        "/api/simulator/assess-vitals",
        json={},
    )

    assert response.status_code == 401


def test_public_staff_cannot_assess_vitals(client):
    login(client, PUBLIC_STAFF)

    response = client.post(
        "/api/simulator/assess-vitals",
        json={},
    )

    assert response.status_code == 403


def test_invalid_vitals_api(client):
    login(client, NURSE)

    response = client.post(
        "/api/simulator/assess-vitals",
        json={
            "spo2": 105,
            "heart_rate": 75,
            "systolic": 120,
            "diastolic": 80,
            "respiratory_rate": 16,
            "temperature": 36.6,
        },
    )

    assert response.status_code == 422
