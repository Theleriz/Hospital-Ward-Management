import { useState, type FormEvent } from "react";

import { ApiError, assessPews, submitStaffReview, type PewsAssessment, type PewsInput, type SimulatorWard } from "./api";

const COMPONENTS: Record<string, string> = {
  respiratory_rate: "Частота дыхания",
  respiratory_distress: "Дыхательные усилия",
  spo2: "SpO₂",
  oxygen_delivery: "Кислород / поддержка дыхания",
  heart_rate: "Пульс",
  systolic_blood_pressure: "Систолическое давление",
  capillary_refill: "Капиллярное наполнение",
};
const RISK_FACTORS = [
  ["BASELINE_VITALS", "Исходные показатели вне обычного диапазона"],
  ["AIRWAY_RISK", "Трахеостома или риск дыхательных путей"],
  ["RESPIRATORY_SUPPORT", "Респираторная поддержка"],
  ["IMMUNOCOMPROMISED", "Нейтропения или иммунодефицит"],
  ["CORRECTED_GESTATION", "Скорректированный срок гестации менее 40 недель"],
  ["NEUROLOGICAL", "Неврологическое заболевание"],
  ["NEURODIVERSITY", "Нейроотличие или нарушение обучения"],
  ["OUTLIER", "Пациент вне обычного профиля палаты"],
] as const;

function errorText(error: unknown) {
  return error instanceof ApiError || error instanceof Error ? error.message : "Сервер недоступен";
}

const blank: Omit<PewsInput, "patient_id"> = {
  respiratory_rate: null, respiratory_distress: null, spo2: null, oxygen_device: null,
  oxygen_delivery_pct: null, oxygen_delivery_lpm: null, oxygen_delivery_unit: null,
  heart_rate: null, systolic: null, systolic_code: null, crt_seconds: null,
  temperature: null, temperature_route: null, avpu: null,
  sepsis_suspected: null, septic_shock_suspected: null, clinical_intuition: null,
  carer_response: null, risk_factors_confirmed: null, risk_factors: null,
  measurement_confirmed: false,
};

export default function PewsSimulator({ wards }: { wards: SimulatorWard[] }) {
  const [wardId, setWardId] = useState("");
  const [patientId, setPatientId] = useState("");
  const [values, setValues] = useState<Omit<PewsInput, "patient_id">>({ ...blank });
  const [assessment, setAssessment] = useState<PewsAssessment | null>(null);
  const [reviewSent, setReviewSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const ward = wards.find((item) => String(item.ward_id) === wardId);
  const selectedPatient = ward?.patients.find((item) => String(item.patient_id) === patientId);
  function update<K extends keyof Omit<PewsInput, "patient_id">>(key: K, value: Omit<PewsInput, "patient_id">[K]) {
    setValues((current) => ({ ...current, [key]: value,
      ...(key === "measurement_confirmed" ? {} : { measurement_confirmed: false }) }));
    setAssessment(null); setReviewSent(false); setError(null); setNotice(null);
  }
  function selectOxygenDevice(value: PewsInput["oxygen_device"]) {
    setValues((current) => ({ ...current, oxygen_device: value,
      oxygen_delivery_pct: null, oxygen_delivery_lpm: null, oxygen_delivery_unit: null,
      measurement_confirmed: false }));
    setAssessment(null); setReviewSent(false); setError(null); setNotice(null);
  }
  function selectOxygenUnit(value: PewsInput["oxygen_delivery_unit"]) {
    setValues((current) => ({ ...current, oxygen_delivery_unit: value,
      oxygen_delivery_pct: null, oxygen_delivery_lpm: null, measurement_confirmed: false }));
    setAssessment(null); setReviewSent(false); setError(null); setNotice(null);
  }
  function selectSystolicCode(value: PewsInput["systolic_code"] | "MEASURED") {
    setValues((current) => ({ ...current,
      systolic_code: value === "MEASURED" ? null : value,
      systolic: null, measurement_confirmed: false }));
    setAssessment(null); setReviewSent(false); setError(null); setNotice(null);
  }
  function selectWard(value: string) {
    setWardId(value);
    const next = wards.find((item) => String(item.ward_id) === value);
    setPatientId(next?.patients[0] ? String(next.patients[0].patient_id) : "");
    setAssessment(null); setReviewSent(false); setError(null); setNotice(null);
  }
  function setNumber(key: "respiratory_rate" | "spo2" | "heart_rate" | "systolic" | "crt_seconds" | "temperature" | "oxygen_delivery_pct" | "oxygen_delivery_lpm", value: string) {
    const parsed = value === "" ? null : Number(value);
    update(key, parsed === null || Number.isFinite(parsed) ? parsed as never : null as never);
    if (key === "systolic" && parsed !== null) update("systolic_code", null);
  }
  function fillExample() {
    setValues({ respiratory_rate: 30, respiratory_distress: "NONE",
      spo2: 98, oxygen_device: "AIR", oxygen_delivery_pct: null, oxygen_delivery_lpm: null,
      oxygen_delivery_unit: null, heart_rate: 100, systolic: 100, systolic_code: null,
      crt_seconds: 2, temperature: 36.8, temperature_route: "AXILLA", avpu: "A",
      sepsis_suspected: false, septic_shock_suspected: false, clinical_intuition: false,
      carer_response: "S", risk_factors_confirmed: true, risk_factors: [], measurement_confirmed: false });
    setAssessment(null); setReviewSent(false); setError(null);
    setNotice("Заполнены вымышленные данные для демонстрации. Подтвердите измерения перед расчётом.");
  }
  function payload(): PewsInput {
    return { ...values, patient_id: Number(patientId) };
  }
  async function assess(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setAssessment(null); setReviewSent(false); setError(null); setNotice(null);
    try { setAssessment(await assessPews(payload())); }
    catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  }
  async function requestReview() {
    if (!patientId || !assessment?.reason || busy) return;
    setBusy(true); setError(null);
    try {
      await submitStaffReview(Number(patientId), assessment.reason);
      setReviewSent(true); setNotice("Заявка сохранена. Она доступна только назначенному врачу.");
    } catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  }

  return <div className="sim-layout">
    <form className="card form-grid" onSubmit={assess}>
      <h2 className="form-title">PEWS NHS England — учебная оценка ребёнка в стационаре</h2>
      {error && <p className="notice notice-error form-wide" role="alert">{error}</p>}
      {notice && <p className="notice notice-ok form-wide" role="status">{notice}</p>}
      <label>Палата
        <select value={wardId} onChange={(event) => selectWard(event.target.value)} required>
          <option value="">Выберите палату</option>
          {wards.map((item) => <option key={item.ward_id} value={item.ward_id}>{item.ward_name}</option>)}
        </select>
      </label>
      <label>Пациент
        <select value={patientId} onChange={(event) => { setPatientId(event.target.value); setAssessment(null); setReviewSent(false); }} required>
          <option value="">Выберите госпитализированного пациента</option>
          {ward?.patients.map((item) => <option key={item.patient_id} value={item.patient_id}>{item.full_name}</option>)}
        </select>
        {typeof selectedPatient?.age_days === "number" && selectedPatient.age_days >= 0 && selectedPatient.age_days <= 27 &&
          <small className="hint">Новорождённый · {selectedPatient.age_days} дней</small>}
      </label>
      <div className="form-wide"><button type="button" className="secondary" onClick={fillExample}>Заполнить вымышленный пример</button></div>

      <label>Частота дыхания (в минуту)
        <input type="number" min="1" max="200" step="1" value={values.respiratory_rate ?? ""}
          onChange={(event) => setNumber("respiratory_rate", event.target.value)} />
      </label>
      <label>Дыхательные усилия
        <select value={values.respiratory_distress ?? ""} onChange={(event) => update("respiratory_distress", (event.target.value || null) as PewsInput["respiratory_distress"])}>
          <option value="">не указано</option><option value="NONE">нет</option><option value="MILD">лёгкие</option>
          <option value="MODERATE">умеренные</option><option value="SEVERE">тяжёлые</option>
        </select>
      </label>
      <label>SpO₂ (%)
        <input type="number" min="0" max="100" step="1" value={values.spo2 ?? ""} onChange={(event) => setNumber("spo2", event.target.value)} />
      </label>
      <label>Кислород / поддержка дыхания
        <select value={values.oxygen_device ?? ""} onChange={(event) => selectOxygenDevice((event.target.value || null) as PewsInput["oxygen_device"])}>
          <option value="">не указано</option><option value="AIR">воздух без кислорода</option>
          <option value="OXYGEN">кислород</option><option value="HIGH_FLOW">High Flow</option>
          <option value="BIPAP">BiPAP</option><option value="CPAP">CPAP</option>
        </select>
      </label>
      {values.oxygen_device === "OXYGEN" && <>
        <label>Единицы кислородной поддержки
          <select value={values.oxygen_delivery_unit ?? ""}
            onChange={(event) => selectOxygenUnit((event.target.value || null) as PewsInput["oxygen_delivery_unit"])}>
            <option value="">не указано</option><option value="PERCENT">FiO₂, %</option><option value="L_MIN">поток, л/мин</option>
          </select>
        </label>
        {values.oxygen_delivery_unit === "PERCENT" && <label>FiO₂ по назначению (%)
          <input type="number" min="1" max="100" step="1" value={values.oxygen_delivery_pct ?? ""}
            onChange={(event) => setNumber("oxygen_delivery_pct", event.target.value)} />
        </label>}
        {values.oxygen_delivery_unit === "L_MIN" && <label>Поток кислорода (л/мин; значения из таблицы)
          <input type="number" min="0.001" max="15" step="any" value={values.oxygen_delivery_lpm ?? ""}
            onChange={(event) => setNumber("oxygen_delivery_lpm", event.target.value)} />
        </label>}
      </>}
      {values.oxygen_device && ["HIGH_FLOW", "BIPAP", "CPAP"].includes(values.oxygen_device) &&
        <p className="hint form-wide">По таблице NHS England High Flow, BiPAP и CPAP дают 4 балла за кислородную поддержку независимо от процента.</p>}
      <label>Пульс (уд/мин)
        <input type="number" min="1" max="300" step="1" value={values.heart_rate ?? ""} onChange={(event) => setNumber("heart_rate", event.target.value)} />
      </label>
      <label>Систолическое давление или код из таблицы
        <select value={values.systolic_code ?? "MEASURED"} onChange={(event) => selectSystolicCode(event.target.value as PewsInput["systolic_code"] | "MEASURED")}>
          <option value="MEASURED">давление измерено</option>
          <option value="NCO">NCO — не измеряли, беспокойства нет (0)</option>
          <option value="U0">U0 — не удалось измерить, беспокойства нет (0)</option>
          <option value="U4">U4 — не удалось измерить, есть беспокойство (4)</option>
        </select>
      </label>
      {values.systolic_code === null && <label>Систолическое давление (мм рт. ст.)
        <input type="number" min="1" max="300" step="1" value={values.systolic ?? ""} onChange={(event) => setNumber("systolic", event.target.value)} />
      </label>}
      <label>Капиллярное наполнение (секунды)
        <input type="number" min="0" max="30" step="1" value={values.crt_seconds ?? ""} onChange={(event) => setNumber("crt_seconds", event.target.value)} />
      </label>
      <label>Температура (°C) — отдельный сигнал таблицы
        <input type="number" min="25" max="45" step="0.1" value={values.temperature ?? ""} onChange={(event) => setNumber("temperature", event.target.value)} />
      </label>
      <label>Способ измерения температуры
        <select value={values.temperature_route ?? ""} onChange={(event) => update("temperature_route", (event.target.value || null) as PewsInput["temperature_route"])}>
          <option value="">не указано</option><option value="AXILLA">подмышечный</option>
          <option value="TYMPANIC">ушной</option><option value="SKIN">кожный</option>
        </select>
      </label>
      <label>Сознание по AVPU — отдельный сигнал
        <select value={values.avpu ?? ""} onChange={(event) => update("avpu", (event.target.value || null) as PewsInput["avpu"])}>
          <option value="">не указано</option><option value="A">A — в сознании</option>
          <option value="V">V — реакция на голос</option><option value="P">P — реакция на боль</option><option value="U">U — нет реакции</option>
        </select>
      </label>
      {(["sepsis_suspected", "septic_shock_suspected", "clinical_intuition"] as const).map((key) => <label key={key}>
        {key === "sepsis_suspected" ? "Новое подозрение на сепсис" : key === "septic_shock_suspected" ? "Подозрение на септический шок" : "Клиническая интуиция: ребёнку становится хуже"}
        <select value={values[key] === null ? "" : values[key] ? "yes" : "no"}
          onChange={(event) => update(key, event.target.value === "" ? null : event.target.value === "yes")}>
          <option value="">не указано</option><option value="no">нет</option><option value="yes">да</option>
        </select>
      </label>)}
      <label>Ответ ребёнка/родителя на вопрос об изменении состояния
        <select value={values.carer_response ?? ""} onChange={(event) => update("carer_response", (event.target.value || null) as PewsInput["carer_response"])}>
          <option value="">не указано</option><option value="W">W — хуже</option><option value="S">S — без изменений</option>
          <option value="B">B — лучше</option><option value="A">A — родитель спит</option><option value="U">U — недоступен</option>
        </select>
      </label>
      <fieldset className="form-wide choice-field">
        <legend>Факторы риска из таблицы</legend>
        {RISK_FACTORS.map(([key, label]) => <label key={key} style={{ flexDirection: "row", alignItems: "flex-start" }}>
          <input style={{ height: 18, width: 18, flexShrink: 0 }} type="checkbox" disabled={values.risk_factors_confirmed !== true}
            checked={(values.risk_factors ?? []).includes(key)} onChange={(event) => update("risk_factors", event.target.checked
              ? [...(values.risk_factors ?? []), key] : (values.risk_factors ?? []).filter((item) => item !== key))} />
          {label}
        </label>)}
        <label style={{ flexDirection: "row", alignItems: "flex-start" }}>
          <input style={{ height: 18, width: 18, flexShrink: 0 }} type="checkbox" checked={values.risk_factors_confirmed === true}
            onChange={(event) => { update("risk_factors_confirmed", event.target.checked); if (!event.target.checked) update("risk_factors", null); else update("risk_factors", []); }} />
          Проверка факторов риска завершена
        </label>
      </fieldset>
      <label className="form-wide" style={{ flexDirection: "row", alignItems: "flex-start" }}>
        <input style={{ height: 18, width: 18, flexShrink: 0 }} type="checkbox" checked={values.measurement_confirmed}
          onChange={(event) => update("measurement_confirmed", event.target.checked)} />
        Достоверность учебных измерений подтверждена
      </label>
      <div className="form-wide"><button type="submit" disabled={busy || !patientId}>{busy ? "Проверка…" : "Рассчитать PEWS"}</button></div>

      {assessment && <section className="form-wide" aria-live="polite">
        <h3>{assessment.status === "REVIEW_REQUIRED" ? "Нужна проверка персоналом" : "Результат PEWS"}</h3>
        {assessment.chart_name && <p>Выбрана таблица: <strong>{assessment.chart_name}</strong></p>}
        {assessment.status === "CLASSIFIED" && <p>Сумма PEWS: <strong>{assessment.score}</strong>
          {assessment.risk_band && ` · уровень по таблице NHS: ${assessment.risk_band}`}</p>}
        <p>{assessment.reason}</p>
        {assessment.signals.map((signal) => <p className="notice notice-error" key={signal}>{signal}</p>)}
        {assessment.status === "REVIEW_REQUIRED" && <div>
          <p>Число баллов не рассчитывается. Заявка врачу сохраняется только по нажатию и не создаёт экстренное оповещение.</p>
          <button type="button" disabled={busy || reviewSent || !patientId} onClick={() => void requestReview()}>
            {reviewSent ? "Отправлено на проверку" : "Отправить на проверку"}
          </button>
        </div>}
        {assessment.status === "CLASSIFIED" && <div className="table-wrap"><table className="table">
          <thead><tr><th>Показатель</th><th>Баллы</th></tr></thead>
          <tbody>{Object.entries(assessment.component_scores).map(([key, score]) => <tr key={key}>
            <td>{COMPONENTS[key] ?? key}</td><td>{score}</td>
          </tr>)}</tbody>
        </table></div>}
        <p className="hint"><a href={assessment.source_url} target="_blank" rel="noreferrer">Оригинальная таблица NHS England</a></p>
      </section>}
    </form>
    <aside className="card">
      <h2>Учебная оценка</h2>
      <p className="hint">Сервер выбирает таблицу по дате рождения, активной госпитализации и явному типу палаты. Поддерживается только общая палата Paediatrics.</p>
      <p className="hint">Температура, AVPU, подозрение на сепсис, клиническая интуиция, ответ ребёнка/родителя и факторы риска отображаются отдельно от суммы. Низкий PEWS их не скрывает.</p>
      <p className="hint">PEWS не является диагнозом. Этот экран не создаёт и не запускает экстренное оповещение.</p>
    </aside>
  </div>;
}
