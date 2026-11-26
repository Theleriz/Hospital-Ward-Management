import { useState, type FormEvent } from "react";

import {
  ApiError,
  assessMaternalMews,
  submitStaffReview,
  type MaternalMewsAssessment,
  type MaternalMewsInput,
  type SimulatorWard,
} from "./api";

const ADDITIONAL_CONCERNS = [
  ["HEALTHCARE_PROFESSIONAL", "Обеспокоенность медицинского работника"],
  ["WOMAN_FAMILY", "Обеспокоенность женщины или семьи"],
  ["SIGNIFICANT_THERAPY", "Значимая дополнительная терапия, например кислород"],
  ["INCREASED_PAIN", "Усиление боли или потребности в обезболивании"],
  ["VAGINAL_BLEEDING", "Значимое влагалищное кровотечение"],
  ["REDUCED_URINE_OUTPUT", "Снижение диуреза"],
  ["ALTERED_CONSCIOUSNESS", "Снижение уровня сознания или реакции"],
] as const;

const COMPONENT_NAMES: Record<string, string> = {
  respiratory_rate: "Частота дыхания",
  spo2: "SpO₂",
  temperature: "Температура",
  heart_rate: "Пульс",
  systolic: "Систолическое давление",
  diastolic: "Диастолическое давление",
};

const LEVEL_NAMES: Record<NonNullable<MaternalMewsAssessment["risk_level"]>, string> = {
  LOW: "Низкий",
  LOW_MEDIUM: "Низко-средний",
  MEDIUM: "Средний",
  HIGH: "Высокий",
};

const blank: Omit<MaternalMewsInput, "patient_id"> = {
  maternal_status: null,
  status_confirmed: false,
  delivery_at: null,
  respiratory_rate: null,
  spo2: null,
  temperature: null,
  heart_rate: null,
  systolic: null,
  diastolic: null,
  measurements_confirmed: false,
  additional_concerns_confirmed: false,
  additional_concerns: [],
};

function errorText(error: unknown) {
  return error instanceof ApiError || error instanceof Error ? error.message : "Сервер недоступен";
}

export default function MaternalMewsSimulator({ wards }: { wards: SimulatorWard[] }) {
  const [wardId, setWardId] = useState("");
  const [patientId, setPatientId] = useState("");
  const [values, setValues] = useState<Omit<MaternalMewsInput, "patient_id">>({ ...blank });
  const [assessment, setAssessment] = useState<MaternalMewsAssessment | null>(null);
  const [reviewSent, setReviewSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const ward = wards.find((item) => String(item.ward_id) === wardId);
  function clearResult() {
    setAssessment(null);
    setReviewSent(false);
    setError(null);
    setNotice(null);
  }
  function updateMeasurement<K extends "respiratory_rate" | "spo2" | "temperature" | "heart_rate" | "systolic" | "diastolic">(
    key: K,
    value: number | null,
  ) {
    setValues((current) => ({ ...current, [key]: value, measurements_confirmed: false }));
    clearResult();
  }
  function setNumber(key: "respiratory_rate" | "spo2" | "temperature" | "heart_rate" | "systolic" | "diastolic", text: string) {
    const value = text === "" ? null : Number(text);
    updateMeasurement(key, value === null || Number.isFinite(value) ? value : null);
  }
  function selectWard(value: string) {
    setWardId(value);
    const nextWard = wards.find((item) => String(item.ward_id) === value);
    setPatientId(nextWard?.patients[0] ? String(nextWard.patients[0].patient_id) : "");
    setValues({ ...blank });
    clearResult();
  }
  function updateMaternalStatus(value: "PREGNANT" | "POSTPARTUM" | null) {
    setValues((current) => ({
      ...current,
      maternal_status: value,
      status_confirmed: value !== null,
      delivery_at: value === "PREGNANT" ? null : current.delivery_at,
    }));
    clearResult();
  }
  function updateConcern(code: string, checked: boolean) {
    const selected = values.additional_concerns ?? [];
    setValues((current) => ({
      ...current,
      additional_concerns: checked
        ? [...selected, code]
        : selected.filter((item) => item !== code),
      additional_concerns_confirmed: false,
    }));
    clearResult();
  }
  function payload(): MaternalMewsInput {
    let deliveryAt: string | null = null;
    if (values.delivery_at) {
      const parsed = new Date(values.delivery_at);
      if (!Number.isNaN(parsed.getTime())) deliveryAt = parsed.toISOString();
    }
    return { ...values, delivery_at: deliveryAt, patient_id: Number(patientId) };
  }
  async function assess(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    clearResult();
    try {
      setAssessment(await assessMaternalMews(payload()));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  async function requestReview() {
    if (!patientId || !assessment?.reason || busy) return;
    setBusy(true);
    setError(null);
    try {
      await submitStaffReview(Number(patientId), assessment.reason);
      setReviewSent(true);
      setNotice("Заявка сохранена. Она доступна только назначенному врачу.");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return <div className="sim-layout">
    <form className="card form-grid" onSubmit={assess}>
      <h2 className="form-title">Акушерский MEWS NHS England — учебная оценка матери</h2>
      {error && <p className="notice notice-error form-wide" role="alert">{error}</p>}
      {notice && <p className="notice notice-ok form-wide" role="status">{notice}</p>}

      <label>Палата
        <select value={wardId} onChange={(event) => selectWard(event.target.value)} required>
          <option value="">Выберите палату</option>
          {wards.map((item) => <option key={item.ward_id} value={item.ward_id}>{item.ward_name}</option>)}
        </select>
      </label>
      <label>Пациент
        <select value={patientId} onChange={(event) => { setPatientId(event.target.value); clearResult(); }} required>
          <option value="">Выберите госпитализированного пациента</option>
          {ward?.patients.map((item) => <option key={item.patient_id} value={item.patient_id}>{item.full_name}</option>)}
        </select>
      </label>

      <label>Статус матери — подтвердите беременность или укажите, что роды уже произошли
        <select value={values.maternal_status ?? ""}
          onChange={(event) => updateMaternalStatus((event.target.value || null) as MaternalMewsInput["maternal_status"])}>
          <option value="">не подтверждён</option>
          <option value="PREGNANT">Беременность подтверждена</option>
          <option value="POSTPARTUM">После родов</option>
        </select>
      </label>
      {values.maternal_status === "POSTPARTUM" && <label>
        Дата и время родов
        <input type="datetime-local" value={values.delivery_at ?? ""} required
          onChange={(event) => {
            setValues((current) => ({ ...current, delivery_at: event.target.value || null }));
            clearResult();
          }} />
      </label>}

      <label>Частота дыхания (в минуту)
        <input type="number" min="0" step="1" value={values.respiratory_rate ?? ""}
          onChange={(event) => setNumber("respiratory_rate", event.target.value)} />
      </label>
      <label>SpO₂ (%)
        <input type="number" min="0" max="100" step="1" value={values.spo2 ?? ""}
          onChange={(event) => setNumber("spo2", event.target.value)} />
      </label>
      <label>Температура (°C)
        <input type="number" min="25" max="45" step="0.1" value={values.temperature ?? ""}
          onChange={(event) => setNumber("temperature", event.target.value)} />
      </label>
      <label>Пульс (уд/мин)
        <input type="number" min="0" step="1" value={values.heart_rate ?? ""}
          onChange={(event) => setNumber("heart_rate", event.target.value)} />
      </label>
      <label>Систолическое давление (мм рт. ст.)
        <input type="number" min="0" step="1" value={values.systolic ?? ""}
          onChange={(event) => setNumber("systolic", event.target.value)} />
      </label>
      <label>Диастолическое давление (мм рт. ст.)
        <input type="number" min="0" step="1" value={values.diastolic ?? ""}
          onChange={(event) => setNumber("diastolic", event.target.value)} />
      </label>

      <fieldset className="form-wide choice-field">
        <legend>Дополнительные признаки из таблицы</legend>
        {ADDITIONAL_CONCERNS.map(([code, label]) => <label key={code} style={{ flexDirection: "row", alignItems: "flex-start" }}>
          <input style={{ height: 18, width: 18, flexShrink: 0 }} type="checkbox"
            checked={(values.additional_concerns ?? []).includes(code)}
            onChange={(event) => updateConcern(code, event.target.checked)} />
          {label}
        </label>)}
        <label style={{ flexDirection: "row", alignItems: "flex-start" }}>
          <input style={{ height: 18, width: 18, flexShrink: 0 }} type="checkbox"
            checked={values.additional_concerns_confirmed}
            onChange={(event) => { setValues((current) => ({ ...current, additional_concerns_confirmed: event.target.checked })); clearResult(); }} />
          Проверка дополнительных признаков завершена
        </label>
      </fieldset>
      <label className="form-wide" style={{ flexDirection: "row", alignItems: "flex-start" }}>
        <input style={{ height: 18, width: 18, flexShrink: 0 }} type="checkbox"
          checked={values.measurements_confirmed}
          onChange={(event) => { setValues((current) => ({ ...current, measurements_confirmed: event.target.checked })); clearResult(); }} />
        Достоверность измерений подтверждена
      </label>
      <div className="form-wide">
        <button type="submit" disabled={busy || !patientId}>{busy ? "Проверка…" : "Рассчитать MEWS"}</button>
      </div>

      {assessment && <section className="form-wide" aria-live="polite">
        <h3>{assessment.status === "REVIEW_REQUIRED" ? "Нужна проверка персоналом" : "Результат акушерского MEWS"}</h3>
        {assessment.status === "CLASSIFIED" && <>
          <p>Сумма MEWS: <strong>{assessment.score}</strong> · уровень: <strong>{assessment.risk_level ? LEVEL_NAMES[assessment.risk_level] : "—"}</strong></p>
          <p>{assessment.pulse_rule === "ANTENATAL"
            ? "Для пульса использована строка для беременности."
            : assessment.pulse_rule === "POSTPARTUM_UNDER_48H"
              ? "Для пульса использована строка до 48 часов после родов."
              : "Для пульса использована строка от 48 часов после родов."}</p>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Показатель</th><th>Баллы</th></tr></thead>
            <tbody>{Object.entries(assessment.component_scores).map(([key, score]) => <tr key={key}>
              <td>{COMPONENT_NAMES[key] ?? key}</td><td>{score}</td>
            </tr>)}</tbody>
          </table></div>
        </>}
        {assessment.reason && <p>{assessment.reason}</p>}
        {assessment.additional_concerns.length > 0 && <div className="notice notice-error">
          <strong>Дополнительные признаки (отдельно от суммы):</strong>
          <ul>{assessment.additional_concerns.map((item) => <li key={item}>{item}</li>)}</ul>
          <p>По таблице при наличии признака ориентируются как минимум на низко-средний уровень; при сумме выше 2 уровень повышается на одну категорию.</p>
        </div>}
        {assessment.status === "REVIEW_REQUIRED" && <p>Баллы не рассчитываются. Заявка сохраняется только по нажатию кнопки ниже и не создаёт экстренное оповещение.</p>}
        {(assessment.status === "REVIEW_REQUIRED" || assessment.additional_concerns.length > 0) && <button type="button"
          disabled={busy || reviewSent || !patientId} onClick={() => void requestReview()}>
          {reviewSent ? "Отправлено на проверку" : "Отправить на проверку"}
        </button>}
        <p className="hint"><a href={assessment.source_url} target="_blank" rel="noreferrer">Финальная таблица MEWS, рисунки 3–4 (BMJ Medicine)</a></p>
      </section>}
    </form>
    <aside className="card">
      <h2>Учебная оценка матери</h2>
      <p className="hint">Применяется при явно подтверждённой беременности или в первые 4 недели после родов. Пол и палата не определяют применимость.</p>
      <p className="hint">Оценка не является диагнозом. Она не создаёт и не запускает экстренное оповещение.</p>
      <p className="hint"><a href={assessment?.scope_source_url ?? "https://www.england.nhs.uk/long-read/the-maternal-care-bundle/"}
        target="_blank" rel="noreferrer">Область применения: NHS England, раздел 2.1</a></p>
    </aside>
  </div>;
}
