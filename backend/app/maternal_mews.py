"""NHS England national maternity MEWS (educational implementation).

Scoring thresholds are transcribed from the final formatted chart in figures
3–4 of Gerry et al., BMJ Medicine 2024;3:e000748. Applicability follows NHS
England's Maternal Care Bundle, section 2.1.
"""

from datetime import datetime, timedelta, timezone
from math import isfinite
from typing import Any


SOURCE_URL = "https://bmjmedicine.bmj.com/content/3/1/e000748"
SCOPE_SOURCE_URL = "https://www.england.nhs.uk/long-read/the-maternal-care-bundle/"
POLICY_VERSION = "NHS England national maternity MEWS, figures 3–4 (2024)"
POSTPARTUM_SCOPE = timedelta(days=28)
POSTPARTUM_PULSE_START = timedelta(hours=48)

CONCERN_LABELS = {
    "HEALTHCARE_PROFESSIONAL": "Обеспокоенность медицинского работника",
    "WOMAN_FAMILY": "Обеспокоенность женщины или семьи",
    "SIGNIFICANT_THERAPY": "Значимая дополнительная терапия, например кислород",
    "INCREASED_PAIN": "Усиление боли или потребности в обезболивании",
    "VAGINAL_BLEEDING": "Значимое влагалищное кровотечение",
    "REDUCED_URINE_OUTPUT": "Снижение диуреза",
    "ALTERED_CONSCIOUSNESS": "Снижение уровня сознания или реакции",
}


def _score_respiratory_rate(value: float) -> int:
    if value <= 6 or value >= 25:
        return 2
    if value <= 8 or value >= 22:
        return 1
    return 0


def _score_spo2(value: float) -> int:
    if value <= 92:
        return 2
    if value <= 94:
        return 1
    return 0


def _score_temperature(value: float) -> int:
    if value <= 35.6 or value >= 37.5:
        return 2
    if value <= 36.1 or value >= 37.3:
        return 1
    return 0


def _score_antenatal_pulse(value: float) -> int:
    if value <= 70 or value >= 122:
        return 2
    if value <= 85 or value <= 121 and value >= 113:
        return 1
    return 0


def _score_postpartum_pulse(value: float) -> int:
    if value <= 50 or value >= 108:
        return 2
    if value <= 70 or value >= 99:
        return 1
    return 0


def _score_systolic(value: float) -> int:
    if value <= 93 or value >= 145:
        return 2
    if value <= 100 or value >= 136:
        return 1
    return 0


def _score_diastolic(value: float) -> int:
    if value <= 56 or value >= 97:
        return 2
    if value <= 61 or value >= 80:
        return 1
    return 0


def _review(reason: str) -> dict[str, Any]:
    return {
        "status": "REVIEW_REQUIRED",
        "score": None,
        "component_scores": {},
        "additional_concerns": [],
        "risk_level": None,
        "pulse_rule": None,
        "reason": reason,
        "policy_version": POLICY_VERSION,
        "source_url": SOURCE_URL,
        "scope_source_url": SCOPE_SOURCE_URL,
    }


def _aware_utc(value: datetime | None) -> datetime | None:
    if value is None or value.tzinfo is None or value.utcoffset() is None:
        return None
    return value.astimezone(timezone.utc)


def _numeric(value: Any, *, integer: bool = False) -> bool:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not isfinite(value) or value < 0:
        return False
    return not integer or float(value).is_integer()


def assess_maternal_mews(
    *,
    active_admission: bool,
    maternal_status: str | None,
    delivery_at: datetime | None,
    status_confirmed: bool,
    measurements: dict[str, Any],
    evaluated_at: datetime,
) -> dict[str, Any]:
    """Assess an explicitly confirmed pregnancy/recent birth; never raises alerts."""
    if not active_admission:
        return _review("Нет активной госпитализации. Передайте случай на проверку персоналу.")
    if status_confirmed is not True or maternal_status not in ("PREGNANT", "POSTPARTUM"):
        return _review("Подтвердите беременность или укажите дату и время родов.")

    evaluation_time = _aware_utc(evaluated_at)
    if evaluation_time is None:
        return _review("Не удалось подтвердить время оценки. Передайте случай на проверку персоналу.")

    postpartum_elapsed: timedelta | None = None
    if maternal_status == "PREGNANT":
        if delivery_at is not None:
            return _review("Данные противоречат друг другу: для подтверждённой беременности указана дата родов.")
        pulse_rule = "ANTENATAL"
    else:
        birth_time = _aware_utc(delivery_at)
        if birth_time is None:
            return _review("Для послеродовой оценки нужны дата и время родов с часовым поясом.")
        postpartum_elapsed = evaluation_time - birth_time
        if postpartum_elapsed < timedelta(0):
            return _review("Дата и время родов находятся в будущем. Проверьте данные.")
        if postpartum_elapsed > POSTPARTUM_SCOPE:
            return _review("После родов прошло больше 4 недель. Эта версия MEWS не применима.")
        pulse_rule = "POSTPARTUM_48H_PLUS" if postpartum_elapsed >= POSTPARTUM_PULSE_START else "POSTPARTUM_UNDER_48H"

    required = (
        ("respiratory_rate", True), ("spo2", True), ("temperature", False),
        ("heart_rate", True), ("systolic", True), ("diastolic", True),
    )
    missing = [name for name, _ in required if measurements.get(name) is None]
    if missing:
        return _review("Не хватает обязательных измерений. Проверьте показатели и отправьте случай персоналу.")
    if measurements.get("measurements_confirmed") is not True:
        return _review("Измерения не подтверждены. Проверьте их перед оценкой.")
    if measurements.get("additional_concerns_confirmed") is not True:
        return _review("Не подтверждена проверка дополнительных признаков.")

    for name, integer in required:
        if not _numeric(measurements[name], integer=integer):
            return _review("Есть некорректное или противоречивое измерение. Передайте случай на проверку персоналу.")
    if measurements["spo2"] > 100:
        return _review("SpO₂ вне допустимого диапазона. Проверьте измерение.")
    temperature_tenths = measurements["temperature"] * 10
    if not 25 <= measurements["temperature"] <= 45 or abs(temperature_tenths - round(temperature_tenths)) > 1e-6:
        return _review("Температура не соответствует поддерживаемой точности 0,1 °C. Проверьте измерение.")

    pulse_scorer = _score_postpartum_pulse if pulse_rule == "POSTPARTUM_48H_PLUS" else _score_antenatal_pulse
    component_scores = {
        "respiratory_rate": _score_respiratory_rate(measurements["respiratory_rate"]),
        "spo2": _score_spo2(measurements["spo2"]),
        "temperature": _score_temperature(measurements["temperature"]),
        "heart_rate": pulse_scorer(measurements["heart_rate"]),
        "systolic": _score_systolic(measurements["systolic"]),
        "diastolic": _score_diastolic(measurements["diastolic"]),
    }
    score = sum(component_scores.values())
    levels = ("LOW", "LOW_MEDIUM", "MEDIUM", "HIGH")
    level_index = 0 if score <= 1 else 1 if score <= 4 else 2 if score <= 7 else 3

    concerns = measurements.get("additional_concerns")
    if not isinstance(concerns, list) or any(code not in CONCERN_LABELS for code in concerns):
        return _review("Дополнительные признаки не указаны корректно. Передайте случай на проверку персоналу.")
    if concerns:
        if score < 2:
            level_index = max(level_index, 1)
        elif score > 2:
            level_index = min(level_index + 1, len(levels) - 1)
    concern_names = [CONCERN_LABELS[code] for code in concerns]
    reason = ("Дополнительные признаки: " + "; ".join(concern_names)) if concern_names else ""

    return {
        "status": "CLASSIFIED",
        "score": score,
        "component_scores": component_scores,
        "additional_concerns": concern_names,
        "risk_level": levels[level_index],
        "pulse_rule": pulse_rule,
        "reason": reason,
        "policy_version": POLICY_VERSION,
        "source_url": SOURCE_URL,
        "scope_source_url": SCOPE_SOURCE_URL,
    }
