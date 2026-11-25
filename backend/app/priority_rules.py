
"""Demo priority classification for adult patients (18+).

Educational simulation only. Not for clinical use.
"""

import math


# Existing MedBase demo events
EVENTS = {
    "LOW_OXYGEN": ("CRITICAL", "SpO2 упала до 84%"),
    "FAST_HEART_RATE": ("HIGH", "ЧСС 135 уд/мин"),
    "WEAK_SENSOR_SIGNAL": ("LOW", "Слабый сигнал датчика"),
    "CHEST_PAIN": ("CRITICAL", "Пациент сообщает о боли в груди"),
    "PATIENT_CALL": ("HIGH", "Пациент нажал кнопку вызова"),
    "WATER_REQUEST": ("LOW", "Пациент просит воды"),
}


def classify_priority(event_type: str) -> dict:
    """Return the existing MedBase demo priority for a known event."""
    if event_type not in EVENTS:
        raise ValueError("Unknown event. Staff review required.")

    priority, description = EVENTS[event_type]
    return {"priority": priority, "description": description}


def validate_vitals(spo2, heart_rate, systolic, diastolic,
                    respiratory_rate, temperature):
    """Validate monitor input, not medical normality."""
    values = {
        "spo2": spo2,
        "heart_rate": heart_rate,
        "systolic": systolic,
        "diastolic": diastolic,
        "respiratory_rate": respiratory_rate,
        "temperature": temperature,
    }

    for name, value in values.items():
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(f"{name} must be a number")
        if not math.isfinite(value):
            raise ValueError(f"{name} must be finite")

    if not 0 <= spo2 <= 100:
        raise ValueError("Invalid SpO2")
    if not 1 <= heart_rate <= 300:
        raise ValueError("Invalid heart rate")
    if not 1 <= systolic <= 300:
        raise ValueError("Invalid systolic pressure")
    if not 1 <= diastolic <= 250 or diastolic >= systolic:
        raise ValueError("Invalid diastolic pressure")
    if not 1 <= respiratory_rate <= 100:
        raise ValueError("Invalid respiratory rate")
    if not 25 <= temperature <= 45:
        raise ValueError("Invalid temperature")

    return values


def classify_vitals(spo2, heart_rate, systolic, diastolic,
                    respiratory_rate, temperature,
                    measurement_confirmed=False,
                    patient_at_rest=False,
                    acute_symptoms=False):
    """Match explicitly defined adult educational scenarios."""

    values = validate_vitals(
        spo2, heart_rate, systolic, diastolic,
        respiratory_rate, temperature
    )

    matches = []

    if measurement_confirmed and spo2 == 84:
        matches.append(("CRITICAL", "EM-01: confirmed SpO2 84% demo scenario."))

    if (measurement_confirmed and patient_at_rest
            and heart_rate == 135 and not acute_symptoms):
        matches.append(("HIGH", "EM-02: confirmed resting heart rate 135 bpm demo scenario."))

    if not measurement_confirmed:
        return {
            "priority": None,
            "status": "REVIEW_REQUIRED",
            "reason": "Measurement reliability has not been confirmed.",
            "measurements": values,
        }

    if acute_symptoms:
        return {
            "priority": None,
            "status": "REVIEW_REQUIRED",
            "reason": "Acute symptoms require immediate staff assessment.",
            "measurements": values,
        }

    if not matches:
        return {
            "priority": None,
            "status": "REVIEW_REQUIRED",
            "reason": "No defined demo scenario matches these measurements.",
            "measurements": values,
        }

    # Prefer the more urgent matched demo scenario.
    matches.sort(key=lambda item: {"CRITICAL": 0, "HIGH": 1}[item[0]])
    priority = matches[0][0]

    return {
        "priority": priority,
        "status": "CLASSIFIED",
        "reason": " ".join(reason for _, reason in matches),
        "measurements": values,
    }

# --- NEWS2 assessment (separate from the existing named demo scenarios) ---

def assess_news2_vitals(spo2, heart_rate, systolic, diastolic,
                        respiratory_rate, temperature,
                        measurement_confirmed=False, patient_at_rest=False,
                        acute_symptoms=False, *, consciousness=None,
                        supplemental_oxygen=None, spo2_scale=1,
                        scale2_confirmed=False, age_years=None, pregnant=None):
    """Validate the demo context before using the standalone NEWS2 calculator.

    patient_at_rest is accepted for compatibility; it is not a NEWS2 criterion.
    Acute-symptom routing is a separate MedBase rule, not NEWS2 points.
    """
    from app.news2 import calculate_news2

    try:
        values = validate_vitals(spo2, heart_rate, systolic, diastolic,
                                 respiratory_rate, temperature)
    except OverflowError as exc:
        raise ValueError("Measurements must be finite") from exc
    for name, value in values.items():
        if name != "temperature" and value != int(value):
            raise ValueError(f"{name} must be a whole number")
    if not math.isclose(temperature * 10, round(temperature * 10), rel_tol=0, abs_tol=1e-7):
        raise ValueError("temperature must have at most one decimal place")
    for name, value in (("measurement_confirmed", measurement_confirmed),
                        ("patient_at_rest", patient_at_rest),
                        ("acute_symptoms", acute_symptoms),
                        ("scale2_confirmed", scale2_confirmed)):
        if type(value) is not bool:
            raise ValueError(f"{name} must be boolean")
    for name, value in (("supplemental_oxygen", supplemental_oxygen), ("pregnant", pregnant)):
        if value is not None and type(value) is not bool:
            raise ValueError(f"{name} must be boolean or None")
    if age_years is not None and (type(age_years) is not int or not 0 <= age_years <= 130):
        raise ValueError("age_years must be an integer from 0 to 130")
    if type(spo2_scale) is not int or spo2_scale not in (1, 2):
        raise ValueError("spo2_scale must be integer 1 or 2")
    if consciousness is not None and consciousness not in (
            "ALERT", "NEW_CONFUSION", "VOICE", "PAIN", "UNRESPONSIVE"):
        raise ValueError("Invalid consciousness assessment")

    result = {
        "status": "REVIEW_REQUIRED", "priority": None, "reason": "",
        "measurements": values, "news2_score": None, "component_scores": {},
        "news2_risk": None, "single_parameter_trigger": False,
        "classification_basis": None, "policy_version": "MEDBASE-NEWS2-DEMO-1",
    }
    if acute_symptoms:
        result.update(status="CLASSIFIED", priority="CRITICAL",
                      classification_basis="ACUTE_SYMPTOMS_OVERRIDE",
                      reason="Сообщены острые симптомы: требуется немедленная оценка персоналом. "
                             "CRITICAL — отдельное учебное правило MedBase; NEWS2 не вычислен.")
        return result
    if not measurement_confirmed:
        result["reason"] = "Достоверность измерений не подтверждена. Нужна проверка персоналом."
        return result
    if age_years is None or pregnant is None:
        result["reason"] = "Укажите возраст и сведения о беременности, чтобы подтвердить область применения."
        return result
    if age_years < 18 or pregnant:
        result["reason"] = "Учебный расчёт поддерживает только пациентов 18+ вне беременности. Нужна оценка персоналом."
        return result
    if consciousness is None or supplemental_oxygen is None:
        result["reason"] = "Для полного NEWS2 укажите сознание и сведения о дополнительном кислороде."
        return result
    if spo2_scale == 2 and not scale2_confirmed:
        result["reason"] = "Шкала SpO2 2 требует подтверждения документированного клинического решения."
        return result

    score = calculate_news2(spo2=spo2, heart_rate=heart_rate, systolic=systolic,
                            respiratory_rate=respiratory_rate, temperature=temperature,
                            consciousness=consciousness, supplemental_oxygen=supplemental_oxygen,
                            spo2_scale=spo2_scale, scale2_confirmed=scale2_confirmed)
    result.update(score)
    result.update(status="CLASSIFIED", classification_basis="NEWS2",
                  reason=f"NEWS2 = {score['news2_score']}; приоритет MedBase = {score['priority']}. "
                         "Низкий балл не исключает опасного состояния.")
    return result
