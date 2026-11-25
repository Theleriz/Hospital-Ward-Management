"""NEWS2 arithmetic for the MedBase educational simulator.

Scores: Royal College of Physicians, NEWS2 (2017), Charts 1 and 2.
The LOW/HIGH/CRITICAL mapping is MedBase policy, not RCP category names.
The caller must check adult scope, pregnancy, measurement reliability and
acute clinical concerns before using this calculation to create an alert.
Educational simulation only; not for clinical use.
"""

import math


# Each pair is (inclusive upper boundary, points).
BANDS = {
    "respiratory_rate": ((8, 3), (11, 1), (20, 0), (24, 2), (math.inf, 3)),
    "spo2": ((91, 3), (93, 2), (95, 1), (math.inf, 0)),
    "systolic": ((90, 3), (100, 2), (110, 1), (219, 0), (math.inf, 3)),
    "heart_rate": ((40, 3), (50, 1), (90, 0), (110, 1), (130, 2), (math.inf, 3)),
    "temperature": ((35.0, 3), (36.0, 1), (38.0, 0), (39.0, 1), (math.inf, 2)),
}


def _points(value, bands):
    for upper, points in bands:
        if value <= upper:
            return points
    raise ValueError("Value cannot be scored")


def _validate_measurements(values):
    # Technical limits of this demo, not ranges of clinical normality.
    limits = {
        "spo2": (0, 100), "heart_rate": (1, 300), "systolic": (1, 300),
        "respiratory_rate": (1, 100), "temperature": (25, 45),
    }
    for name, value in values.items():
        if type(value) not in (int, float):
            raise ValueError(f"{name} must be a number")
        try:
            finite = math.isfinite(value)
        except OverflowError:
            finite = False
        if not finite:
            raise ValueError(f"{name} must be finite")
        low, high = limits[name]
        if not low <= value <= high:
            raise ValueError(f"{name} is outside the demo input limits")
        if name != "temperature" and value != int(value):
            raise ValueError(f"{name} must be a whole number")
    temp = values["temperature"] * 10
    if not math.isclose(temp, round(temp), rel_tol=0, abs_tol=1e-7):
        raise ValueError("temperature must have at most one decimal place")


def calculate_news2(*, spo2, heart_rate, systolic, respiratory_rate,
                    temperature, consciousness, supplemental_oxygen,
                    spo2_scale=1, scale2_confirmed=False):
    """Calculate a complete score; no database access or alert creation.

    Consciousness: ALERT, NEW_CONFUSION, VOICE, PAIN or UNRESPONSIVE.
    Scale 2 confirmation represents a documented clinical decision already
    made for a synthetic patient with confirmed hypercapnic respiratory failure.
    Diastolic pressure is not an input to NEWS2 scoring.
    """
    values = {
        "spo2": spo2, "heart_rate": heart_rate, "systolic": systolic,
        "respiratory_rate": respiratory_rate, "temperature": temperature,
    }
    _validate_measurements(values)
    if consciousness not in ("ALERT", "NEW_CONFUSION", "VOICE", "PAIN", "UNRESPONSIVE"):
        raise ValueError("A valid consciousness assessment is required")
    if type(supplemental_oxygen) is not bool:
        raise ValueError("supplemental_oxygen must be True or False")
    if type(spo2_scale) is not int or spo2_scale not in (1, 2):
        raise ValueError("spo2_scale must be integer 1 or 2")
    if type(scale2_confirmed) is not bool:
        raise ValueError("scale2_confirmed must be True or False")
    if spo2_scale == 2 and not scale2_confirmed:
        raise ValueError("SpO2 Scale 2 requires documented clinical confirmation")

    components = {name: _points(value, BANDS[name]) for name, value in values.items()}
    if spo2_scale == 2:
        if spo2 <= 87:
            components["spo2"] = _points(spo2, ((83, 3), (85, 2), (87, 1)))
        elif spo2 <= 92 or not supplemental_oxygen:
            components["spo2"] = 0
        else:
            components["spo2"] = _points(spo2, ((94, 1), (96, 2), (math.inf, 3)))

    components["consciousness"] = 0 if consciousness == "ALERT" else 3
    components["supplemental_oxygen"] = 2 if supplemental_oxygen else 0
    total = sum(components.values())
    single_three = 3 in components.values()

    # Preserve the official risk category separately from MedBase routing.
    if total >= 7:
        risk, priority = "HIGH", "CRITICAL"
    elif total >= 5:
        risk, priority = "MEDIUM", "HIGH"
    elif single_three:
        risk, priority = "LOW_MEDIUM", "HIGH"
    else:
        risk, priority = "LOW", "LOW"

    return {
        "news2_score": total,
        "component_scores": components,
        "news2_risk": risk,
        "single_parameter_trigger": single_three,
        "priority": priority,
    }
