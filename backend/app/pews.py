"""Educational implementation of NHS England inpatient NPEWS (Nov 2026).

All numeric bands below were transcribed from the four NHS England inpatient
observation charts. Clinical triggers are returned separately from arithmetic.
This is not a diagnostic tool and does not raise or route alerts.
"""

from datetime import date
import math

VERSION = "NHS-ENGLAND-INPATIENT-NPEWS-2026-11"
SOURCE = "https://www.england.nhs.uk/publication/national-pews-observation-and-escalation-charts/"

AGE_CHARTS = {
    "0_11_MONTHS": {
        "label": "NHS England PEWS: 0–11 месяцев",
        "url": "https://www.england.nhs.uk/wp-content/uploads/2026/11/inpatient-npews-chart-0-11-months.pdf",
    },
    "1_4_YEARS": {
        "label": "NHS England PEWS: 1–4 года",
        "url": "https://www.england.nhs.uk/wp-content/uploads/2026/11/inpatient-npews-chart-1-4-years.pdf",
    },
    "5_12_YEARS": {
        "label": "NHS England PEWS: 5–12 лет",
        "url": "https://www.england.nhs.uk/wp-content/uploads/2026/11/inpatient-npews-chart-5-12-years.pdf",
    },
    "13_PLUS": {
        "label": "NHS England PEWS: 13 лет и старше",
        "url": "https://www.england.nhs.uk/wp-content/uploads/2026/11/inpatient-npews-chart-over-13-years.pdf",
    },
}

# Each tuple is (inclusive upper bound, points). Boundaries follow the printed
# band edges in the relevant chart; bands may alternate between scores.
# PEWS chart scores use 0, 1, 2 and 4; no NEWS2 thresholds are shared here.
_RR = {
    "0_11_MONTHS": ((9, 4), (14, 2), (24, 0), (34, 1), (44, 0), (54, 1), (64, 2), (math.inf, 4)),
    "1_4_YEARS": ((9, 4), (14, 2), (34, 0), (44, 1), (54, 2), (math.inf, 4)),
    "5_12_YEARS": ((9, 4), (12, 2), (17, 1), (22, 0), (37, 1), (47, 2), (math.inf, 4)),
    "13_PLUS": ((12, 4), (17, 1), (22, 0), (27, 1), (37, 2), (math.inf, 4)),
}
_HR = {
    "0_11_MONTHS": ((74, 4), (84, 2), (114, 1), (144, 0), (164, 1), (174, 2), (math.inf, 4)),
    "1_4_YEARS": ((54, 4), (64, 2), (94, 1), (134, 0), (144, 1), (164, 2), (math.inf, 4)),
    "5_12_YEARS": ((54, 4), (64, 2), (74, 1), (114, 0), (144, 1), (164, 2), (math.inf, 4)),
    "13_PLUS": ((44, 4), (54, 2), (74, 1), (94, 0), (124, 1), (134, 2), (math.inf, 4)),
}
_SBP = {
    "0_11_MONTHS": ((44, 4), (54, 2), (74, 1), (84, 0), (94, 1), (114, 2), (math.inf, 4)),
    "1_4_YEARS": ((44, 4), (54, 2), (84, 1), (94, 0), (114, 1), (124, 2), (math.inf, 4)),
    "5_12_YEARS": ((64, 4), (74, 2), (94, 1), (104, 0), (114, 1), (124, 2), (math.inf, 4)),
    "13_PLUS": ((74, 4), (84, 2), (94, 1), (114, 0), (124, 1), (134, 2), (math.inf, 4)),
}


def age_on(dob: date, today: date) -> int:
    """Completed years; the 18th birthday is the MedBase scope boundary."""
    return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))


def chart_for_age(dob: date, today: date) -> str | None:
    if dob > today:
        return None
    age = age_on(dob, today)
    if age >= 18:
        return None
    if age == 0:
        return "0_11_MONTHS"
    if age <= 4:
        return "1_4_YEARS"
    if age <= 12:
        return "5_12_YEARS"
    return "13_PLUS"


def _points(value: int, bands: tuple[tuple[float, int], ...]) -> int:
    for upper, points in bands:
        if value <= upper:
            return points
    raise ValueError("Value cannot be scored")


def _signals(measurements: dict) -> list[str]:
    """Collect independent triggers even when another field blocks scoring."""
    signals = []
    if measurements.get("clinical_intuition") is True:
        signals.append("Клиническая интуиция: персоналу кажется, что ребёнку хуже.")
    if measurements.get("carer_response") == "W":
        signals.append("Ребёнок/родитель сообщает, что состояние стало хуже.")
    if measurements.get("sepsis_suspected") is True:
        signals.append("Отдельный сигнал: подозрение на сепсис.")
    if measurements.get("septic_shock_suspected") is True:
        signals.append("Отдельный сигнал: подозрение на септический шок.")
    avpu = measurements.get("avpu")
    if avpu == "V":
        signals.append("Отдельный сигнал PEWS: изменённая реакция по AVPU до V.")
    elif avpu in ("P", "U"):
        signals.append("Отдельный сигнал PEWS: AVPU P/U требует внимания независимо от суммы.")
    temperature = measurements.get("temperature")
    if (type(temperature) in (int, float) and math.isfinite(temperature)
            and (temperature >= 38 or temperature < 36)):
        signals.append("Температурный сигнал из раздела THINK! Could this be sepsis?")
    factors = measurements.get("risk_factors")
    if isinstance(factors, list) and factors and all(isinstance(item, str) for item in factors):
        signals.append("Отмечены дополнительные факторы риска: " + ", ".join(factors))
    return signals


def _review(reason: str, *, chart: str | None = None, signals: list[str] | None = None) -> dict:
    info = AGE_CHARTS.get(chart) if chart else None
    return {
        "status": "REVIEW_REQUIRED", "score": None, "component_scores": {},
        "signals": signals or [], "reason": reason, "chart_key": chart,
        "chart_name": info["label"] if info else None,
        "source_url": info["url"] if info else SOURCE, "policy_version": VERSION,
    }


def assess_pews(*, dob: date | None, today: date, ward_type: str | None,
                active_admission: bool, measurements: dict) -> dict:
    """Choose an age chart and calculate only with complete, confirmed input."""
    signals = _signals(measurements)
    if dob is None or dob > today:
        return _review("Не удалось подтвердить возраст пациента.", signals=signals)
    chart = chart_for_age(dob, today)
    if chart is None:
        return _review("Возраст или дата рождения не подходят для детского PEWS.", signals=signals)
    if not active_admission:
        return _review("Не найдена активная госпитализация пациента.", chart=chart, signals=signals)
    if ward_type != "Paediatrics":
        if ward_type in ("Neonatal", "Maternity", "Obstetrics"):
            reason = "Неонатальный или акушерский контекст не поддерживается этим этапом."
        else:
            reason = "PEWS доступен только при активной госпитализации в палату типа Paediatrics."
        return _review(reason, chart=chart, signals=signals)

    required = ("respiratory_rate", "respiratory_distress", "spo2", "oxygen_device",
                "heart_rate", "crt_seconds", "temperature",
                "temperature_route", "avpu", "sepsis_suspected",
                "septic_shock_suspected", "clinical_intuition", "carer_response",
                "risk_factors_confirmed", "measurement_confirmed")
    missing = [name for name in required if measurements.get(name) is None]
    if missing:
        return _review("Не заполнены необходимые измерения или признаки: " + ", ".join(missing), chart=chart, signals=signals)
    if measurements["measurement_confirmed"] is not True:
        return _review("Достоверность измерений не подтверждена.", chart=chart, signals=signals)
    if measurements["risk_factors_confirmed"] is not True:
        return _review("Проверка дополнительных факторов риска не подтверждена.", chart=chart, signals=signals)

    systolic = measurements.get("systolic")
    systolic_code = measurements.get("systolic_code")
    if systolic is None and systolic_code is None:
        return _review("Нужно указать систолическое давление или код попытки измерения.", chart=chart, signals=signals)
    if systolic is not None and systolic_code is not None:
        return _review("Укажите либо давление, либо один код попытки измерения.", chart=chart, signals=signals)
    if systolic_code not in (None, "NCO", "U0", "U4"):
        return _review("Неизвестный код отсутствующего измерения давления.", chart=chart, signals=signals)

    for field, low, high in (("respiratory_rate", 1, 200), ("spo2", 0, 100),
                             ("heart_rate", 1, 300),
                             ("crt_seconds", 0, 30)):
        value = measurements[field]
        if type(value) is not int or not low <= value <= high:
            return _review(f"Проверьте значение {field}.", chart=chart, signals=signals)
    if systolic is not None and (type(systolic) is not int or not 1 <= systolic <= 300):
        return _review("Проверьте значение systolic.", chart=chart, signals=signals)
    temperature = measurements["temperature"]
    if type(temperature) not in (int, float) or not math.isfinite(temperature) or not 25 <= temperature <= 45:
        return _review("Проверьте значение температуры.", chart=chart, signals=signals)

    device = measurements["oxygen_device"]
    if device not in ("AIR", "OXYGEN", "HIGH_FLOW", "BIPAP", "CPAP"):
        return _review("Неизвестный тип кислородной поддержки.", chart=chart, signals=signals)
    oxygen_pct = measurements.get("oxygen_delivery_pct")
    oxygen_lpm = measurements.get("oxygen_delivery_lpm")
    oxygen_unit = measurements.get("oxygen_delivery_unit")
    if device == "AIR":
        if oxygen_pct is not None or oxygen_lpm is not None or oxygen_unit is not None:
            return _review("Для воздуха без кислородной поддержки удалите дозу кислорода.", chart=chart, signals=signals)
        oxygen_points = 0
    elif device in ("HIGH_FLOW", "BIPAP", "CPAP"):
        # The same fixed 4-point instruction is printed on all four charts.
        oxygen_points = 4
    elif oxygen_unit == "PERCENT":
        if (type(oxygen_pct) is not int or not 0 < oxygen_pct <= 100
                or oxygen_lpm is not None):
            return _review("Укажите одну допустимую дозу кислорода в процентах.", chart=chart, signals=signals)
        if oxygen_pct >= 60:
            oxygen_points = 4
        elif oxygen_pct >= 40:
            oxygen_points = 2
        else:
            oxygen_points = 1
    elif oxygen_unit == "L_MIN":
        if (type(oxygen_lpm) not in (int, float) or not math.isfinite(oxygen_lpm)
                or oxygen_lpm <= 0 or oxygen_pct is not None):
            return _review("Укажите одну допустимую дозу кислорода в л/мин.", chart=chart, signals=signals)
        # Accept only values explicitly printed in the charts; do not invent
        # interpolated bands for unlisted flows.
        flow = float(oxygen_lpm)
        lpm_scores = {0.1: 1, 1.0: 1, 2.0: 1, 4.0: 2, 6.0: 2,
                      8.0: 4, 10.0: 4, 15.0: 4}
        oxygen_points = 1 if 0 < flow < 0.01 else lpm_scores.get(flow)
        if oxygen_points is None:
            return _review("Такое значение л/мин не опубликовано в таблице PEWS.", chart=chart, signals=signals)
    else:
        return _review("Выберите единицу дозы кислорода: процент или л/мин.", chart=chart, signals=signals)

    distress_points = {"NONE": 0, "MILD": 1, "MODERATE": 2, "SEVERE": 4}.get(
        measurements["respiratory_distress"])
    if distress_points is None:
        return _review("Неизвестная категория дыхательных усилий.", chart=chart, signals=signals)
    if measurements["temperature_route"] not in ("AXILLA", "TYMPANIC", "SKIN"):
        return _review("Неизвестный способ измерения температуры.", chart=chart, signals=signals)
    if measurements["avpu"] not in ("A", "V", "P", "U"):
        return _review("Неизвестная оценка AVPU.", chart=chart, signals=signals)
    if any(type(measurements[key]) is not bool for key in
           ("sepsis_suspected", "septic_shock_suspected", "clinical_intuition")):
        return _review("Не подтверждён ответ на клинические вопросы.", chart=chart, signals=signals)
    if measurements["carer_response"] not in ("W", "S", "B", "A", "U"):
        return _review("Не подтверждён ответ ребёнка или родителя/опекуна.", chart=chart, signals=signals)
    factors = measurements.get("risk_factors")
    if not isinstance(factors, list) or any(not isinstance(item, str) for item in factors):
        return _review("Не удалось проверить факторы риска по таблице.", chart=chart, signals=signals)

    components = {
        "respiratory_rate": _points(measurements["respiratory_rate"], _RR[chart]),
        "respiratory_distress": distress_points,
        "spo2": 0 if measurements["spo2"] >= 95 else 1 if measurements["spo2"] >= 92 else 4,
        "oxygen_delivery": oxygen_points,
        "heart_rate": _points(measurements["heart_rate"], _HR[chart]),
        "systolic_blood_pressure": ({"NCO": 0, "U0": 0, "U4": 4}[systolic_code]
                                    if systolic_code is not None
                                    else _points(systolic, _SBP[chart])),
        "capillary_refill": 2 if measurements["crt_seconds"] >= 3 else 0,
    }
    score = sum(components.values())

    band = ("LOW" if 1 <= score <= 4 else "MEDIUM" if 5 <= score <= 8 else
            "HIGH" if 9 <= score <= 12 else "EMERGENCY" if score >= 13 else None)
    info = AGE_CHARTS[chart]
    return {
        "status": "CLASSIFIED", "score": score, "component_scores": components,
        "signals": signals, "reason": "Учебный PEWS для стационарной общей детской палаты. "
        "Сигналы таблицы отображаются независимо от суммы; оценка не является диагнозом "
        "и не создаёт экстренное оповещение.", "chart_key": chart,
        "chart_name": info["label"], "source_url": info["url"],
        "risk_band": band, "policy_version": VERSION,
    }
