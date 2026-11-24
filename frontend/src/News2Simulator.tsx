import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  ApiError, assessNews2Vitals, raiseNews2Alert, submitStaffReview,
  type News2Assessment, type News2Consciousness, type News2VitalSigns, type SimulatorWard,
} from "./api";

type NumericField = "spo2" | "heart_rate" | "systolic" | "diastolic" | "respiratory_rate" | "temperature";
type Readings = Record<NumericField, string>;

const EMPTY: Readings = {
  spo2: "", heart_rate: "", systolic: "", diastolic: "", respiratory_rate: "", temperature: "",
};
const FIELDS: { key: NumericField; label: string; min: number; max: number; step: number }[] = [
  { key: "spo2", label: "SpO₂ (%)", min: 0, max: 100, step: 1 },
  { key: "heart_rate", label: "Пульс (уд/мин)", min: 1, max: 300, step: 1 },
  { key: "systolic", label: "Систолическое давление (мм рт. ст.)", min: 1, max: 300, step: 1 },
  { key: "diastolic", label: "Диастолическое давление (не входит в NEWS2)", min: 1, max: 250, step: 1 },
  { key: "respiratory_rate", label: "Частота дыхания (в минуту)", min: 1, max: 100, step: 1 },
  { key: "temperature", label: "Температура (°C)", min: 25, max: 45, step: 0.1 },
];
const COMPONENT_LABELS: Record<string, string> = {
  spo2: "SpO₂", heart_rate: "Пульс", systolic: "Систолическое давление",
  respiratory_rate: "Дыхание", temperature: "Температура", consciousness: "Сознание",
  supplemental_oxygen: "Дополнительный кислород",
};
const RISK_LABELS = { LOW: "низкий", LOW_MEDIUM: "низкий–средний: отдельный показатель 3",
  MEDIUM: "средний", HIGH: "высокий" };

function errorText(error: unknown): string {
  return error instanceof ApiError || error instanceof Error ? error.message : "Сервер недоступен";
}

export default function News2Simulator({ wards, onBusyChange }: {
  wards: SimulatorWard[];
  onBusyChange: (busy: boolean) => void;
}) {
  const [wardId, setWardId] = useState("");
  const [patientId, setPatientId] = useState("");
  const [readings, setReadings] = useState<Readings>({ ...EMPTY });
  const [age, setAge] = useState("");
  const [pregnancy, setPregnancy] = useState("");
  const [consciousness, setConsciousness] = useState<News2Consciousness | "">("");
  const [oxygen, setOxygen] = useState("");
  const [scale, setScale] = useState<1 | 2>(1);
  const [scaleConfirmed, setScaleConfirmed] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [acute, setAcute] = useState(false);
  const [assessment, setAssessment] = useState<News2Assessment | null>(null);
  const [reviewSent, setReviewSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<"assess" | "create" | null>(null);
  const revision = useRef(0);
  const assessedRevision = useRef(-1);
  const inFlight = useRef(false);

  useEffect(() => {
    if (wardId && wards.some((w) => String(w.ward_id) === wardId)) return;
    const first = wards.find((w) => w.patients.length) ?? wards[0];
    if (first) {
      setWardId(String(first.ward_id));
      setPatientId(first.patients[0] ? String(first.patients[0].patient_id) : "");
    }
  }, [wards, wardId]);

  useEffect(() => {
    onBusyChange(busy !== null);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);

  const ward = wards.find((w) => String(w.ward_id) === wardId);
  const locked = busy === "create";

  function invalidate() {
    revision.current += 1;
    assessedRevision.current = -1;
    setAssessment(null);
    setReviewSent(false);
    setError(null);
    setNotice(null);
  }

  function resetEpisode() {
    invalidate();
    setReadings({ ...EMPTY });
    setAge(""); setPregnancy(""); setConsciousness(""); setOxygen("");
    setScale(1); setScaleConfirmed(false); setConfirmed(false); setAcute(false);
  }

  function chooseWard(value: string) {
    resetEpisode();
    setWardId(value);
    const next = wards.find((w) => String(w.ward_id) === value);
    setPatientId(next?.patients[0] ? String(next.patients[0].patient_id) : "");
  }

  function fillExample() {
    invalidate();
    setReadings({ spo2: "84", heart_rate: "135", systolic: "120", diastolic: "80",
      respiratory_rate: "16", temperature: "36.6" });
    setAge("30"); setPregnancy("no"); setConsciousness("ALERT"); setOxygen("yes");
    setScale(1); setScaleConfirmed(false); setAcute(false); setConfirmed(false);
    setNotice("Заполнены синтетические данные. Подтвердите достоверность учебных измерений и выполните расчёт.");
  }

  function payload(): News2VitalSigns {
    const numbers = {} as Record<NumericField, number>;
    for (const field of FIELDS) {
      const raw = readings[field.key].trim();
      if (!raw || !Number.isFinite(Number(raw))) throw new Error(`Заполните поле: ${field.label}`);
      numbers[field.key] = Number(raw);
    }
    const ageNumber = age.trim() ? Number(age) : null;
    if (ageNumber !== null && (!Number.isInteger(ageNumber) || ageNumber < 0 || ageNumber > 130)) {
      throw new Error("Возраст должен быть целым числом от 0 до 130");
    }
    return { ...numbers, mode: "NEWS2", age_years: ageNumber,
      pregnant: pregnancy === "yes" ? true : pregnancy === "no" ? false : null,
      consciousness: consciousness || null,
      supplemental_oxygen: oxygen === "yes" ? true : oxygen === "no" ? false : null,
      spo2_scale: scale, scale2_confirmed: scaleConfirmed,
      measurement_confirmed: confirmed, patient_at_rest: false, acute_symptoms: acute };
  }

  async function assess(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    invalidate();
    const currentRevision = revision.current;
    try {
      const body = payload();
      inFlight.current = true;
      setBusy("assess");
      const result = await assessNews2Vitals(body);
      if (revision.current !== currentRevision) return;
      assessedRevision.current = currentRevision;
      setAssessment(result);
    } catch (err) {
      if (revision.current === currentRevision) setError(errorText(err));
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  async function createAlert() {
    if (inFlight.current || !wardId || assessment?.status !== "CLASSIFIED" || !assessment.priority
        || assessedRevision.current !== revision.current) return;
    const currentRevision = revision.current;
    try {
      const vitals = payload();
      inFlight.current = true;
      setBusy("create");
      setError(null); setNotice(null);
      const raised = await raiseNews2Alert({ ward_id: Number(wardId),
        patient_id: patientId ? Number(patientId) : null, vitals });
      if (revision.current !== currentRevision) return;
      setAssessment(null);
      assessedRevision.current = -1;
      setNotice(`${raised.alert_id} создано; приоритет ${raised.assessment.priority}; назначено: `
        + `${raised.assigned_nurse_id ?? "никому — нет медсестры палаты на смене"}`);
    } catch (err) {
      if (revision.current === currentRevision) setError(errorText(err));
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  const canCreate = !!wardId && assessment?.status === "CLASSIFIED" && !!assessment.priority
    && assessedRevision.current === revision.current && busy === null;

  return (
    <div className="sim-layout">
      <form className="card form-grid" onSubmit={assess}>
        <h2 className="form-title">NEWS2 — учебная оценка показателей</h2>
        {error && <p className="notice notice-error form-wide" role="alert">{error}</p>}
        {notice && <p className="notice notice-ok form-wide" role="status">{notice}</p>}
        {!wards.length && <p className="notice form-wide">Список палат не загружен. Проверьте соединение с сервером.</p>}
        <label>Палата
          <select value={wardId} disabled={locked} onChange={(e) => chooseWard(e.target.value)} required>
            {wards.map((w) => <option key={w.ward_id} value={w.ward_id}>{w.ward_name}</option>)}
          </select>
          <span className="hint">Получит: {ward?.nurse_on_duty ?? "нет медсестры палаты на смене"}</span>
        </label>
        <label>Пациент
          <select value={patientId} disabled={locked} onChange={(e) => { resetEpisode(); setPatientId(e.target.value); }}>
            {ward?.patients.map((p) => <option key={p.patient_id} value={p.patient_id}>{p.full_name}</option>)}
            <option value="">без привязки — учебные данные</option>
          </select>
        </label>
        <div className="form-wide">
          <button type="button" className="secondary" disabled={locked} onClick={fillExample}>Заполнить учебный пример</button>
        </div>
        {FIELDS.map((field) => (
          <label key={field.key}>{field.label}
            <input type="number" value={readings[field.key]} min={field.min} max={field.max} step={field.step}
              required disabled={locked} onChange={(e) => {
                invalidate(); setConfirmed(false);
                setReadings((old) => ({ ...old, [field.key]: e.target.value }));
              }} />
          </label>
        ))}
        <label>Возраст (лет)
          <input type="number" value={age} min={0} max={130} step={1} disabled={locked}
            onChange={(e) => { invalidate(); setAge(e.target.value); }} />
        </label>
        <label>Беременность
          <select value={pregnancy} disabled={locked} onChange={(e) => { invalidate(); setPregnancy(e.target.value); }}>
            <option value="">не указано</option><option value="no">нет / неприменимо</option><option value="yes">да</option>
          </select>
        </label>
        <label>Сознание / новая спутанность
          <select value={consciousness} disabled={locked} onChange={(e) => {
            invalidate(); setConfirmed(false); setConsciousness(e.target.value as News2Consciousness | "");
          }}>
            <option value="">не указано</option><option value="ALERT">в ясном сознании</option>
            <option value="NEW_CONFUSION">новая или усилившаяся спутанность</option>
            <option value="VOICE">реагирует на голос</option><option value="PAIN">реагирует на боль</option>
            <option value="UNRESPONSIVE">нет реакции</option>
          </select>
        </label>
        <label>Дополнительный кислород
          <select value={oxygen} disabled={locked} onChange={(e) => {
            invalidate(); setConfirmed(false); setOxygen(e.target.value);
          }}><option value="">не указано</option><option value="no">нет — воздух</option><option value="yes">да</option></select>
        </label>
        <label>Шкала SpO₂
          <select value={scale} disabled={locked} onChange={(e) => {
            invalidate(); setConfirmed(false); setScaleConfirmed(false); setScale(Number(e.target.value) as 1 | 2);
          }}><option value={1}>Scale 1 — стандартная</option><option value={2}>Scale 2 — по документированному решению</option></select>
        </label>
        {scale === 2 && <label className="form-wide" style={{ flexDirection: "row", alignItems: "flex-start" }}>
          <input style={{ height: 18, width: 18, flexShrink: 0 }} type="checkbox" checked={scaleConfirmed} disabled={locked}
            onChange={(e) => { invalidate(); setScaleConfirmed(e.target.checked); }} />
          Для учебного пациента подтверждено документированное клиническое решение о Scale 2
        </label>}
        <label className="form-wide" style={{ flexDirection: "row", alignItems: "flex-start" }}>
          <input style={{ height: 18, width: 18, flexShrink: 0 }} type="checkbox" checked={confirmed} disabled={locked}
            onChange={(e) => { invalidate(); setConfirmed(e.target.checked); }} />
          Достоверность учебных измерений подтверждена
        </label>
        <label className="form-wide" style={{ flexDirection: "row", alignItems: "flex-start" }}>
          <input style={{ height: 18, width: 18, flexShrink: 0 }} type="checkbox" checked={acute} disabled={locked}
            onChange={(e) => { invalidate(); setAcute(e.target.checked); }} />
          Сообщены острые симптомы — требуется срочная оценка персоналом
        </label>
        <div className="form-wide">
          <button type="submit" disabled={busy !== null || !wardId}>
            {busy === "assess" ? "Расчёт…" : "Рассчитать приоритет"}
          </button>
        </div>
        {assessment && <section className="form-wide" aria-live="polite">
          <h3>{assessment.status === "REVIEW_REQUIRED" ? "Нужна проверка персоналом" : "Результат оценки"}</h3>
          {assessment.priority && <p>Приоритет MedBase: <b className={`priority priority-${assessment.priority}`}>{assessment.priority}</b></p>}
          {assessment.news2_score !== null && <p>NEWS2: <strong>{assessment.news2_score}</strong>
            {assessment.news2_risk && ` · риск NEWS2: ${RISK_LABELS[assessment.news2_risk]}`}</p>}
          {assessment.classification_basis === "ACUTE_SYMPTOMS_OVERRIDE" && <p>NEWS2 не вычислен: действует отдельное правило острых симптомов.</p>}
          <p>{assessment.reason}</p>
          {assessment.status === "REVIEW_REQUIRED" && <div>
            <p>Это учебная оценка, не диагноз. Заявка не вызывает экстренное оповещение.</p>
            <button type="button" disabled={!patientId || busy !== null || reviewSent} onClick={async () => {
              if (!patientId || !assessment.reason) return;
              setBusy("create"); setError(null);
              try {
                await submitStaffReview(Number(patientId), assessment.reason);
                setReviewSent(true);
              } catch (err) { setError(errorText(err)); }
              finally { setBusy(null); }
            }}>
              {reviewSent ? "Отправлено на проверку" : "Отправить на проверку"}
            </button>
            {!patientId && <p>Выберите пациента, чтобы отправить заявку.</p>}
          </div>}
          {Object.keys(assessment.component_scores).length > 0 && <div className="table-wrap"><table className="table">
            <thead><tr><th>Показатель</th><th>Баллы</th></tr></thead>
            <tbody>{Object.entries(assessment.component_scores).map(([name, points]) => <tr key={name}>
              <td>{COMPONENT_LABELS[name] ?? name}</td><td>{points}</td></tr>)}</tbody>
          </table></div>}
        </section>}
        <div className="form-wide">
          <button type="button" disabled={!canCreate} onClick={() => void createAlert()}>
            {busy === "create" ? "Создание…" : "Создать оповещение по NEWS2"}
          </button>
        </div>
      </form>
      <aside className="card">
        <h2>Учебный режим NEWS2</h2>
        <p className="hint">Вводите синтетические наблюдения. Приоритет рассчитывает сервер; вручную выбрать его в этом режиме нельзя.</p>
        <ul className="legend">
          <li><span className="priority priority-CRITICAL">CRITICAL</span><span>сумма NEWS2 от 7</span></li>
          <li><span className="priority priority-HIGH">HIGH</span><span>сумма 5–6 или отдельный показатель с 3 баллами</span></li>
          <li><span className="priority priority-LOW">LOW</span><span>сумма 0–4 без отдельного показателя с 3 баллами; это не подтверждение безопасности</span></li>
        </ul>
        <p className="hint">Острые симптомы включают отдельный CRITICAL override без расчёта NEWS2. Шкалу 2 система сама не выбирает.</p>
        <p className="hint">Сначала выполните оценку, затем создайте оповещение. Любое изменение данных сбрасывает результат. При создании сервер рассчитывает приоритет повторно.</p>
        <p className="hint">Сигнал обрабатывается существующим постом медсестры, механизмом эскалации и отчётом. 30 секунд — настройка учебной передачи оповещения, а не клиническая рекомендация NEWS2.</p>
      </aside>
    </div>
  );
}
