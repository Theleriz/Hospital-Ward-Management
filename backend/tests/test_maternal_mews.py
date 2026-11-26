"""NHS England national maternity MEWS chart tests (figures 3–4)."""

from datetime import datetime, timedelta, timezone

import pytest

from app.maternal_mews import assess_maternal_mews


NOW = datetime(2026, 11, 25, 12, 0, tzinfo=timezone.utc)


def measurements(**changes):
    result = {
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


def assess(*, status="PREGNANT", birth=None, values=None, active=True, now=NOW, confirmed=True):
    return assess_maternal_mews(
        active_admission=active,
        maternal_status=status,
        delivery_at=birth,
        status_confirmed=confirmed,
        measurements=values or measurements(),
        evaluated_at=now,
    )


@pytest.mark.parametrize("value,expected", [
    (6, 2), (7, 1), (8, 1), (9, 0), (21, 0), (22, 1), (24, 1), (25, 2),
])
def test_figure_4_respiratory_rate_boundaries(value, expected):
    assert assess(values=measurements(respiratory_rate=value))["component_scores"]["respiratory_rate"] == expected


@pytest.mark.parametrize("value,expected", [(92, 2), (93, 1), (94, 1), (95, 0), (100, 0)])
def test_figure_4_spo2_boundaries(value, expected):
    assert assess(values=measurements(spo2=value))["component_scores"]["spo2"] == expected


@pytest.mark.parametrize("value,expected", [
    (35.6, 2), (35.7, 1), (36.1, 1), (36.2, 0), (37.2, 0), (37.3, 1), (37.4, 1), (37.5, 2),
])
def test_figure_3_temperature_boundaries(value, expected):
    assert assess(values=measurements(temperature=value))["component_scores"]["temperature"] == expected


@pytest.mark.parametrize("value,expected", [
    (62, 2), (63, 2), (70, 2), (71, 1), (85, 1), (86, 0), (98, 0),
    (99, 0), (112, 0), (113, 1), (121, 1), (122, 2), (131, 2),
])
def test_figure_3_pulse_before_48_hours(value, expected):
    result = assess(values=measurements(heart_rate=value))
    assert result["pulse_rule"] == "ANTENATAL"
    assert result["component_scores"]["heart_rate"] == expected


@pytest.mark.parametrize("value,expected", [
    (50, 2), (51, 1), (57, 1), (58, 1), (70, 1), (71, 0), (84, 0),
    (85, 0), (98, 0), (99, 1), (107, 1), (108, 2),
])
def test_figure_4_pulse_from_48_hours(value, expected):
    result = assess(status="POSTPARTUM", birth=NOW - timedelta(hours=48),
                    values=measurements(heart_rate=value))
    assert result["pulse_rule"] == "POSTPARTUM_48H_PLUS"
    assert result["component_scores"]["heart_rate"] == expected


@pytest.mark.parametrize("value,expected", [
    (93, 2), (94, 1), (100, 1), (101, 0), (135, 0), (136, 1), (144, 1), (145, 2),
])
def test_figure_4_systolic_boundaries(value, expected):
    assert assess(values=measurements(systolic=value))["component_scores"]["systolic"] == expected


@pytest.mark.parametrize("value,expected", [
    (56, 2), (57, 1), (61, 1), (62, 0), (79, 0), (80, 1), (88, 1), (89, 1), (96, 1), (97, 2),
])
def test_figure_4_diastolic_boundaries(value, expected):
    assert assess(values=measurements(diastolic=value))["component_scores"]["diastolic"] == expected


def test_exact_48_hour_boundary_switches_the_pulse_row():
    delivery_at = NOW - timedelta(hours=48)
    just_before = assess(status="POSTPARTUM", birth=delivery_at + timedelta(microseconds=1),
                         values=measurements(heart_rate=60))
    at_boundary = assess(status="POSTPARTUM", birth=delivery_at,
                         values=measurements(heart_rate=60))
    assert (just_before["pulse_rule"], just_before["component_scores"]["heart_rate"]) == (
        "POSTPARTUM_UNDER_48H", 2,
    )
    assert (at_boundary["pulse_rule"], at_boundary["component_scores"]["heart_rate"]) == (
        "POSTPARTUM_48H_PLUS", 1,
    )


def test_four_week_boundary_is_inclusive_but_later_is_out_of_scope():
    exactly_four_weeks = assess(status="POSTPARTUM", birth=NOW - timedelta(days=28))
    beyond_four_weeks = assess(status="POSTPARTUM", birth=NOW - timedelta(days=28, microseconds=1))
    assert exactly_four_weeks["status"] == "CLASSIFIED"
    assert beyond_four_weeks["status"] == "REVIEW_REQUIRED"
    assert beyond_four_weeks["score"] is None


@pytest.mark.parametrize("kwargs", [
    {"status": None}, {"confirmed": False}, {"active": False},
    {"status": "PREGNANT", "birth": NOW},
    {"status": "POSTPARTUM", "birth": None},
    {"status": "POSTPARTUM", "birth": NOW + timedelta(seconds=1)},
    {"values": measurements(respiratory_rate=None)},
    {"values": measurements(measurements_confirmed=False)},
    {"values": measurements(additional_concerns_confirmed=False)},
    {"values": measurements(additional_concerns=None)},
])
def test_incomplete_or_contradictory_context_needs_review_without_score(kwargs):
    result = assess(**kwargs)
    assert result["status"] == "REVIEW_REQUIRED"
    assert result["score"] is None
    assert result["component_scores"] == {}


def test_additional_concerns_are_separate_and_change_only_the_concern_level():
    result = assess(values=measurements(additional_concerns=["WOMAN_FAMILY"]))
    assert result["score"] == 0
    assert sum(result["component_scores"].values()) == 0
    assert result["risk_level"] == "LOW_MEDIUM"
    assert result["additional_concerns"] == ["Обеспокоенность женщины или семьи"]
    assert "Обеспокоенность" in result["reason"]


def test_additional_concern_raises_a_score_above_two_by_one_category():
    result = assess(values=measurements(respiratory_rate=25, spo2=92,
                                        additional_concerns=["HEALTHCARE_PROFESSIONAL"]))
    assert result["score"] == 4
    assert result["risk_level"] == "MEDIUM"
