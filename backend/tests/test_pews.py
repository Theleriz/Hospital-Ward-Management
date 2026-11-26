from datetime import date
import csv
from pathlib import Path

import pytest

from app.pews import AGE_CHARTS, assess_pews, chart_for_age


TODAY = date(2026, 11, 24)


def readings(**changes):
    result = {
        "respiratory_rate": 20,
        "respiratory_distress": "NONE",
        "spo2": 98,
        "oxygen_device": "AIR",
        "oxygen_delivery_pct": None,
        "oxygen_delivery_lpm": None,
        "oxygen_delivery_unit": None,
        "heart_rate": 100,
        "systolic": 90,
        "systolic_code": None,
        "crt_seconds": 2,
        "temperature": 36.8,
        "temperature_route": "AXILLA",
        "avpu": "A",
        "sepsis_suspected": False,
        "septic_shock_suspected": False,
        "clinical_intuition": False,
        "carer_response": "S",
        "risk_factors_confirmed": True,
        "risk_factors": [],
        "measurement_confirmed": True,
    }
    result.update(changes)
    return result


def eligible(dob, values=None, *, ward_type="Paediatrics", active=True):
    return assess_pews(dob=dob, today=TODAY, ward_type=ward_type,
                       active_admission=active, measurements=values or readings())


@pytest.mark.parametrize(("dob", "expected"), [
    (date(2026, 11, 24), "0_11_MONTHS"),
    (date(2025, 11, 25), "0_11_MONTHS"),
    (date(2025, 11, 24), "1_4_YEARS"),
    (date(2021, 11, 25), "1_4_YEARS"),
    (date(2021, 11, 24), "5_12_YEARS"),
    (date(2013, 11, 25), "5_12_YEARS"),
    (date(2013, 11, 24), "13_PLUS"),
    (date(2008, 11, 25), "13_PLUS"),
    (date(2008, 11, 24), None),  # MedBase 18th-birthday boundary, not an NHS rule
    (date(2026, 11, 25), None),
])
def test_age_chart_boundaries(dob, expected):
    assert chart_for_age(dob, TODAY) == expected


def test_every_supported_age_chart_has_its_own_original_source():
    assert set(AGE_CHARTS) == {"0_11_MONTHS", "1_4_YEARS", "5_12_YEARS", "13_PLUS"}
    assert all("england.nhs.uk/wp-content/uploads/2026/11/inpatient-npews-chart" in item["url"]
               for item in AGE_CHARTS.values())


@pytest.mark.parametrize("changes", [
    {"respiratory_rate": None}, {"respiratory_distress": None}, {"spo2": None},
    {"oxygen_device": None}, {"heart_rate": None}, {"systolic": None},
    {"crt_seconds": None}, {"temperature": None}, {"temperature_route": None},
    {"avpu": None}, {"sepsis_suspected": None}, {"septic_shock_suspected": None},
    {"clinical_intuition": None}, {"carer_response": None},
    {"risk_factors_confirmed": None}, {"measurement_confirmed": False},
])
def test_incomplete_or_unconfirmed_input_requires_review_without_score(changes):
    result = eligible(date(2018, 1, 1), readings(**changes))
    assert result["status"] == "REVIEW_REQUIRED"
    assert result["score"] is None
    assert result["component_scores"] == {}


@pytest.mark.parametrize(("ward_type", "active"), [
    ("General Medicine", True), ("Neonatal", True), ("Maternity", True),
    ("Obstetrics", True), ("Paediatrics", False),
])
def test_unsupported_admission_context_requires_review(ward_type, active):
    result = eligible(date(2020, 1, 1), ward_type=ward_type, active=active)
    assert result["status"] == "REVIEW_REQUIRED"
    assert result["score"] is None


@pytest.mark.parametrize(("dob", "field", "value", "component", "expected"), [
    # Respiratory rate chart band transitions transcribed from NHS chart shading.
    (date(2026, 1, 1), "respiratory_rate", 70, "respiratory_rate", 4),
    (date(2026, 1, 1), "respiratory_rate", 60, "respiratory_rate", 2),
    (date(2026, 1, 1), "respiratory_rate", 50, "respiratory_rate", 1),
    (date(2023, 1, 1), "respiratory_rate", 60, "respiratory_rate", 4),
    (date(2023, 1, 1), "respiratory_rate", 61, "respiratory_rate", 4),
    (date(2014, 1, 1), "respiratory_rate", 40, "respiratory_rate", 2),
    (date(2014, 1, 1), "respiratory_rate", 50, "respiratory_rate", 4),
    (date(2014, 1, 1), "respiratory_rate", 51, "respiratory_rate", 4),
    (date(2010, 1, 1), "respiratory_rate", 40, "respiratory_rate", 4),
])
def test_age_specific_respiratory_rate_bands(dob, field, value, component, expected):
    result = eligible(dob, readings(**{field: value}))
    assert result["status"] == "CLASSIFIED"
    assert result["component_scores"][component] == expected


@pytest.mark.parametrize(("dob", "field", "value", "component", "expected"), [
    # Selected exact chart rows: each age table has its own pattern and bands.
    (date(2026, 1, 1), "respiratory_rate", 20, "respiratory_rate", 0),
    (date(2026, 1, 1), "respiratory_rate", 30, "respiratory_rate", 1),
    (date(2026, 1, 1), "heart_rate", 80, "heart_rate", 2),
    (date(2026, 1, 1), "systolic", 100, "systolic_blood_pressure", 2),
    (date(2023, 1, 1), "respiratory_rate", 50, "respiratory_rate", 2),
    (date(2023, 1, 1), "heart_rate", 70, "heart_rate", 1),
    (date(2023, 1, 1), "systolic", 80, "systolic_blood_pressure", 1),
    (date(2014, 1, 1), "respiratory_rate", 30, "respiratory_rate", 1),
    (date(2014, 1, 1), "heart_rate", 150, "heart_rate", 2),
    (date(2014, 1, 1), "systolic", 120, "systolic_blood_pressure", 2),
    (date(2010, 1, 1), "heart_rate", 130, "heart_rate", 2),
    (date(2010, 1, 1), "systolic", 130, "systolic_blood_pressure", 2),
])
def test_chart_row_scores_match_age_specific_nhs_table(dob, field, value, component, expected):
    result = eligible(dob, readings(**{field: value}))
    assert result["status"] == "CLASSIFIED"
    assert result["component_scores"][component] == expected


def test_pdf_row_color_goldens_are_independent_of_scoring_tables():
    """Expected scores are transcribed from the visible PDF row fills, not _RR/_HR/_SBP."""
    fixture = Path(__file__).parent / "fixtures" / "pews_nhs_2026_visual_row_goldens.csv"
    dob_by_chart = {
        "0_11_MONTHS": date(2026, 11, 24),
        "1_4_YEARS": date(2023, 11, 24),
        "5_12_YEARS": date(2014, 11, 24),
        "13_PLUS": date(2010, 11, 24),
    }
    component_for = {
        "respiratory_rate": "respiratory_rate",
        "heart_rate": "heart_rate",
        "systolic": "systolic_blood_pressure",
    }
    with fixture.open(encoding="utf-8", newline="") as source:
        rows = list(csv.DictReader(source))
    assert len(rows) >= 80
    for row in rows:
        result = eligible(dob_by_chart[row["age_chart"]], readings(**{
            row["field"]: int(row["printed_value"]),
        }))
        assert result["status"] == "CLASSIFIED", row
        assert result["component_scores"][component_for[row["field"]]] == int(row["points"]), row


def test_each_pdf_colour_boundary_on_both_sides_for_rr_hr_and_systolic():
    """Derive transition cases from independently transcribed colored PDF rows."""
    fixture = Path(__file__).parent / "fixtures" / "pews_nhs_2026_visual_row_goldens.csv"
    dob_by_chart = {
        "0_11_MONTHS": date(2026, 11, 24),
        "1_4_YEARS": date(2023, 11, 24),
        "5_12_YEARS": date(2014, 11, 24),
        "13_PLUS": date(2010, 11, 24),
    }
    component_for = {
        "respiratory_rate": "respiratory_rate",
        "heart_rate": "heart_rate",
        "systolic": "systolic_blood_pressure",
    }
    with fixture.open(encoding="utf-8", newline="") as source:
        rows = list(csv.DictReader(source))
    groups: dict[tuple[str, str], list[tuple[int, int]]] = {}
    for row in rows:
        key = (row["age_chart"], row["field"])
        groups.setdefault(key, []).append((int(row["printed_value"]), int(row["points"])))

    checked_transitions = 0
    for (age_chart, field), chart_rows in groups.items():
        ordered = sorted(chart_rows)
        for (lower_value, lower_points), (upper_value, upper_points) in zip(ordered, ordered[1:]):
            if lower_points == upper_points:
                continue
            first_value_in_upper_row = (lower_value + upper_value + 1) // 2
            cases = ((first_value_in_upper_row - 1, lower_points),
                     (first_value_in_upper_row, upper_points))
            for value, expected_points in cases:
                result = eligible(dob_by_chart[age_chart], readings(**{field: value}))
                assert result["component_scores"][component_for[field]] == expected_points, (
                    age_chart, field, value, expected_points,
                )
            checked_transitions += 1
    assert checked_transitions >= 30


@pytest.mark.parametrize(("dob", "field", "value", "expected"), [
    # Values straddling transitions visible between differently coloured rows.
    (date(2026, 1, 1), "respiratory_rate", 14, 2),
    (date(2026, 1, 1), "respiratory_rate", 15, 0),
    (date(2026, 1, 1), "respiratory_rate", 24, 0),
    (date(2026, 1, 1), "respiratory_rate", 25, 1),
    (date(2023, 1, 1), "respiratory_rate", 34, 0),
    (date(2023, 1, 1), "respiratory_rate", 35, 1),
    (date(2014, 1, 1), "respiratory_rate", 47, 2),
    (date(2014, 1, 1), "respiratory_rate", 48, 4),
    (date(2010, 1, 1), "respiratory_rate", 12, 4),
    (date(2010, 1, 1), "respiratory_rate", 13, 1),
])
def test_respiratory_colour_transition_edges_from_pdf(dob, field, value, expected):
    assert eligible(dob, readings(**{field: value}))["component_scores"][field] == expected


@pytest.mark.parametrize(("percentage", "expected"), [(30, 1), (40, 2), (50, 2), (60, 4)])
def test_oxygen_delivery_bands_match_nhs_chart(percentage, expected):
    result = eligible(date(2014, 1, 1), readings(
        oxygen_device="OXYGEN", oxygen_delivery_pct=percentage,
        oxygen_delivery_unit="PERCENT",
    ))
    assert result["component_scores"]["oxygen_delivery"] == expected


@pytest.mark.parametrize(("device", "percentage"), [
    ("HIGH_FLOW", None), ("HIGH_FLOW", 21), ("HIGH_FLOW", 100),
    ("BIPAP", None), ("BIPAP", 24), ("BIPAP", 100),
    ("CPAP", None), ("CPAP", 30), ("CPAP", 100),
])
def test_supported_noninvasive_devices_score_four_independent_of_oxygen_percent(device, percentage):
    result = eligible(date(2014, 1, 1), readings(
        oxygen_device=device, oxygen_delivery_pct=percentage,
    ))
    assert result["status"] == "CLASSIFIED"
    assert result["component_scores"]["oxygen_delivery"] == 4


@pytest.mark.parametrize(("flow", "expected"), [
    (0.005, 1), (0.1, 1), (1, 1), (2, 1), (4, 2), (6, 2), (8, 4), (10, 4), (15, 4),
])
def test_litres_per_minute_rows_published_in_chart(flow, expected):
    result = eligible(date(2014, 1, 1), readings(
        oxygen_device="OXYGEN", oxygen_delivery_unit="L_MIN", oxygen_delivery_lpm=flow,
    ))
    assert result["component_scores"]["oxygen_delivery"] == expected


def test_unpublished_oxygen_flow_requires_review_without_score():
    result = eligible(date(2014, 1, 1), readings(
        oxygen_device="OXYGEN", oxygen_delivery_unit="L_MIN", oxygen_delivery_lpm=3,
    ))
    assert result["status"] == "REVIEW_REQUIRED"
    assert result["score"] is None


@pytest.mark.parametrize(("code", "expected"), [("NCO", 0), ("U0", 0), ("U4", 4)])
def test_published_absent_blood_pressure_codes(code, expected):
    result = eligible(date(2014, 1, 1), readings(systolic=None, systolic_code=code))
    assert result["component_scores"]["systolic_blood_pressure"] == expected


def test_missing_pressure_without_published_code_requires_review():
    result = eligible(date(2014, 1, 1), readings(systolic=None))
    assert result["status"] == "REVIEW_REQUIRED"
    assert result["score"] is None


def test_incomplete_input_keeps_already_recorded_independent_signals():
    result = eligible(date(2014, 1, 1), readings(
        respiratory_rate=None, measurement_confirmed=False, clinical_intuition=True,
        carer_response="W", sepsis_suspected=True, avpu="U", temperature=39,
        risk_factors=["OUTLIER"],
    ))
    assert result["status"] == "REVIEW_REQUIRED"
    assert result["score"] is None
    assert len(result["signals"]) == 6


def test_low_total_keeps_independent_clinical_signal_visible():
    result = eligible(date(2014, 1, 1), readings(clinical_intuition=True))
    assert result["score"] <= 4
    assert result["risk_band"] == "LOW"
    assert any("Клиническая интуиция" in item for item in result["signals"])


def test_avpu_and_temperature_are_separate_signals_not_score_components():
    result = eligible(date(2014, 1, 1), readings(avpu="P", temperature=39))
    assert result["component_scores"]
    assert any("AVPU P/U" in item for item in result["signals"])
    assert any("sepsis" in item for item in result["signals"])
    assert "avpu" not in result["component_scores"]
