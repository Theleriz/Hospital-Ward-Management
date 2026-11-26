"""Checks for the standalone NEWS2 calculator; no database is required.

Numerical expectations are based on RCP NEWS2 Charts 1 and 2 (2017).
Several functions check multiple boundaries of the same scoring rule.
"""

import pytest

from app.news2 import calculate_news2


BASE = {
    "spo2": 98, "heart_rate": 75, "systolic": 120,
    "respiratory_rate": 16, "temperature": 36.6,
    "consciousness": "ALERT", "supplemental_oxygen": False,
}


def assess(**changes):
    return calculate_news2(**{**BASE, **changes})


def test_zero_score():
    result = assess()
    assert result["news2_score"] == 0
    assert result["news2_risk"] == "LOW"
    assert result["priority"] == "LOW"
    assert result["single_parameter_trigger"] is False


def test_respiratory_rate_boundaries():
    for value, expected in [(1, 3), (8, 3), (9, 1), (11, 1), (12, 0),
                            (20, 0), (21, 2), (24, 2), (25, 3), (100, 3)]:
        assert assess(respiratory_rate=value)["component_scores"]["respiratory_rate"] == expected, value


def test_scale_one_saturation_boundaries():
    for value, expected in [(0, 3), (83, 3), (84, 3), (91, 3), (92, 2),
                            (93, 2), (94, 1), (95, 1), (96, 0), (100, 0)]:
        assert assess(spo2=value)["component_scores"]["spo2"] == expected, value


def test_systolic_pressure_boundaries():
    for value, expected in [(1, 3), (90, 3), (91, 2), (100, 2), (101, 1),
                            (110, 1), (111, 0), (219, 0), (220, 3), (300, 3)]:
        assert assess(systolic=value)["component_scores"]["systolic"] == expected, value


def test_pulse_boundaries():
    for value, expected in [(1, 3), (40, 3), (41, 1), (50, 1), (51, 0), (90, 0),
                            (91, 1), (110, 1), (111, 2), (130, 2), (131, 3), (300, 3)]:
        assert assess(heart_rate=value)["component_scores"]["heart_rate"] == expected, value


def test_temperature_boundaries():
    for value, expected in [(25.0, 3), (35.0, 3), (35.1, 1), (36.0, 1), (36.1, 0),
                            (38.0, 0), (38.1, 1), (39.0, 1), (39.1, 2), (45.0, 2)]:
        assert assess(temperature=value)["component_scores"]["temperature"] == expected, value


def test_consciousness_scores():
    for state in ("NEW_CONFUSION", "VOICE", "PAIN", "UNRESPONSIVE"):
        result = assess(consciousness=state)
        assert result["component_scores"]["consciousness"] == 3
        assert result["news2_score"] == 3


def test_supplemental_oxygen_adds_two():
    result = assess(supplemental_oxygen=True)
    assert result["component_scores"]["supplemental_oxygen"] == 2
    assert result["news2_score"] == 2


def test_scale_two_on_air():
    for value, expected in [(83, 3), (84, 2), (85, 2), (86, 1), (87, 1),
                            (88, 0), (92, 0), (93, 0), (97, 0), (100, 0)]:
        result = assess(spo2=value, spo2_scale=2, scale2_confirmed=True)
        assert result["component_scores"]["spo2"] == expected, value
        assert result["news2_score"] == expected


def test_scale_two_on_oxygen():
    for value, expected in [(83, 3), (84, 2), (85, 2), (86, 1), (87, 1),
                            (88, 0), (92, 0), (93, 1), (94, 1), (95, 2),
                            (96, 2), (97, 3), (100, 3)]:
        result = assess(spo2=value, supplemental_oxygen=True,
                        spo2_scale=2, scale2_confirmed=True)
        assert result["component_scores"]["spo2"] == expected, value
        assert result["news2_score"] == expected + 2


def test_scale_two_requires_confirmation():
    with pytest.raises(ValueError, match="confirmation"):
        assess(spo2_scale=2)


def test_aggregate_priority_thresholds():
    cases = [
        ({"heart_rate": 91, "temperature": 38.1, "respiratory_rate": 21}, 4, "LOW", "LOW"),
        ({"heart_rate": 91, "temperature": 38.1, "respiratory_rate": 21, "spo2": 94}, 5, "MEDIUM", "HIGH"),
        ({"temperature": 39.1, "respiratory_rate": 21, "spo2": 92}, 6, "MEDIUM", "HIGH"),
        ({"temperature": 39.1, "respiratory_rate": 21, "spo2": 92, "heart_rate": 91}, 7, "HIGH", "CRITICAL"),
    ]
    for changes, total, risk, priority in cases:
        result = assess(**changes)
        assert (result["news2_score"], result["news2_risk"], result["priority"]) == (total, risk, priority)


def test_single_three_is_high_priority():
    result = assess(spo2=84)
    assert result["news2_score"] == 3
    assert result["single_parameter_trigger"] is True
    assert result["news2_risk"] == "LOW_MEDIUM"
    assert result["priority"] == "HIGH"


def test_combined_values_and_oxygen():
    on_air = assess(spo2=84, heart_rate=135)
    on_oxygen = assess(spo2=84, heart_rate=135, supplemental_oxygen=True)
    assert (on_air["news2_score"], on_air["priority"]) == (6, "HIGH")
    assert (on_oxygen["news2_score"], on_oxygen["priority"]) == (8, "CRITICAL")


def test_all_high_components_total_twenty():
    result = assess(spo2=80, heart_rate=140, systolic=80, respiratory_rate=30,
                    temperature=34.0, consciousness="UNRESPONSIVE", supplemental_oxygen=True)
    assert result["news2_score"] == 20
    assert result["news2_risk"] == "HIGH"
    assert result["priority"] == "CRITICAL"


def test_invalid_numeric_values():
    for field in ("spo2", "heart_rate", "systolic", "respiratory_rate", "temperature"):
        for value in (None, True, "98", float("nan"), float("inf"), 10**400):
            with pytest.raises(ValueError):
                assess(**{field: value})
    for field, value in [("spo2", 101), ("heart_rate", -1), ("systolic", -1),
                          ("respiratory_rate", 0), ("temperature", 50)]:
        with pytest.raises(ValueError):
            assess(**{field: value})


def test_invalid_context():
    for changes in [{"consciousness": None}, {"consciousness": "UNKNOWN"},
                    {"supplemental_oxygen": None}, {"supplemental_oxygen": "false"},
                    {"spo2_scale": True}, {"spo2_scale": 3}, {"scale2_confirmed": "true"}]:
        with pytest.raises(ValueError):
            assess(**changes)


def test_fractional_chart_units_are_not_silently_rounded():
    for field, value in [("spo2", 95.5), ("heart_rate", 90.5), ("systolic", 110.5),
                          ("respiratory_rate", 20.5), ("temperature", 36.65)]:
        with pytest.raises(ValueError):
            assess(**{field: value})
