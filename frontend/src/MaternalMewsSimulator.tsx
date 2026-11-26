import { Button } from "@heroui/react";
import { useState, type FormEvent } from "react";

import {
  ApiError,
  assessMaternalMews,
  submitStaffReview,
  type MaternalMewsAssessment,
  type MaternalMewsInput,
  type SimulatorWard,
} from "./api";
import { CheckField, ChoiceField, Field, FormCard, Hint, ResultPanel, ScoreTable, SideCard, SimLayout, Wide } from "./fields";
import { Notice } from "./ui";

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

  return <SimLayout>
    <FormCard title="Акушерский MEWS NHS England — учебная оценка матери" onSubmit={assess}>
      {error && <Wide><Notice kind="error">{error}</Notice></Wide>}
      {notice && <Wide><Notice kind="ok">{notice}</Notice></Wide>}

      <ChoiceField label="Палата" value={wardId} onChange={selectWard} isRequired placeholder="Выберите палату"
        options={wards.map((item) => [String(item.ward_id), item.ward_name] as const)} />
      <ChoiceField label="Пациент" value={patientId} isRequired placeholder="Выберите госпитализированного пациента"
        onChange={(value) => { setPatientId(value); clearResult(); }}
        options={ward?.patients.map((item) => [String(item.patient_id), item.full_name] as const) ?? []} />

      <ChoiceField className="md:col-span-2"
        label="Статус матери — подтвердите беременность или укажите, что роды уже произошли"
        value={values.maternal_status ?? ""}
        onChange={(value) => updateMaternalStatus((value || null) as MaternalMewsInput["maternal_status"])}
        options={[["", "не подтверждён"], ["PREGNANT", "Беременность подтверждена"], ["POSTPARTUM", "После родов"]]} />
      {values.maternal_status === "POSTPARTUM" && <Field label="Дата и время родов" type="datetime-local" isRequired
        value={values.delivery_at ?? ""}
        onChange={(text) => { setValues((current) => ({ ...current, delivery_at: text || null })); clearResult(); }} />}

      <Field label="Частота дыхания (в минуту)" type="number" min="0" step="1" value={values.respiratory_rate}
        onChange={(text) => setNumber("respiratory_rate", text)} />
      <Field label="SpO₂ (%)" type="number" min="0" max="100" step="1" value={values.spo2}
        onChange={(text) => setNumber("spo2", text)} />
      <Field label="Температура (°C)" type="number" min="25" max="45" step="0.1" value={values.temperature}
        onChange={(text) => setNumber("temperature", text)} />
      <Field label="Пульс (уд/мин)" type="number" min="0" step="1" value={values.heart_rate}
        onChange={(text) => setNumber("heart_rate", text)} />
      <Field label="Систолическое давление (мм рт. ст.)" type="number" min="0" step="1" value={values.systolic}
        onChange={(text) => setNumber("systolic", text)} />
      <Field label="Диастолическое давление (мм рт. ст.)" type="number" min="0" step="1" value={values.diastolic}
        onChange={(text) => setNumber("diastolic", text)} />

      <Wide>
        <fieldset className="m-0 flex flex-col gap-2.5 rounded-xl border border-[var(--border)] p-4">
          <legend className="px-1 text-sm font-medium text-[var(--text)]">Дополнительные признаки из таблицы</legend>
          {ADDITIONAL_CONCERNS.map(([code, label]) => (
            <CheckField key={code} checked={(values.additional_concerns ?? []).includes(code)}
              onChange={(checked) => updateConcern(code, checked)}>
              {label}
            </CheckField>
          ))}
          <CheckField checked={values.additional_concerns_confirmed} className="mt-1 font-medium"
            onChange={(checked) => { setValues((current) => ({ ...current, additional_concerns_confirmed: checked })); clearResult(); }}>
            Проверка дополнительных признаков завершена
          </CheckField>
        </fieldset>
      </Wide>
      <Wide>
        <CheckField checked={values.measurements_confirmed}
          onChange={(checked) => { setValues((current) => ({ ...current, measurements_confirmed: checked })); clearResult(); }}>
          Достоверность измерений подтверждена
        </CheckField>
      </Wide>
      <Wide>
        <Button type="submit" isDisabled={busy || !patientId}>{busy ? "Проверка…" : "Рассчитать MEWS"}</Button>
      </Wide>

      {assessment && <ResultPanel title={assessment.status === "REVIEW_REQUIRED" ? "Нужна проверка персоналом" : "Результат акушерского MEWS"}>
        {assessment.status === "CLASSIFIED" && <>
          <p className="m-0">Сумма MEWS: <strong className="text-lg">{assessment.score}</strong> · уровень:{" "}
            <strong>{assessment.risk_level ? LEVEL_NAMES[assessment.risk_level] : "—"}</strong></p>
          <p className="m-0">{assessment.pulse_rule === "ANTENATAL"
            ? "Для пульса использована строка для беременности."
            : assessment.pulse_rule === "POSTPARTUM_UNDER_48H"
              ? "Для пульса использована строка до 48 часов после родов."
              : "Для пульса использована строка от 48 часов после родов."}</p>
          <ScoreTable rows={Object.entries(assessment.component_scores).map(([key, score]) =>
            [COMPONENT_NAMES[key] ?? key, score] as [string, number])} />
        </>}
        {assessment.reason && <p className="m-0">{assessment.reason}</p>}
        {assessment.additional_concerns.length > 0 && <Notice kind="error">
          <strong>Дополнительные признаки (отдельно от суммы):</strong>
          <ul className="my-1 pl-5">{assessment.additional_concerns.map((item) => <li key={item}>{item}</li>)}</ul>
          По таблице при наличии признака ориентируются как минимум на низко-средний уровень; при сумме выше 2 уровень повышается на одну категорию.
        </Notice>}
        {assessment.status === "REVIEW_REQUIRED" && <p className="m-0">Баллы не рассчитываются. Заявка сохраняется только по нажатию кнопки ниже и не создаёт экстренное оповещение.</p>}
        {(assessment.status === "REVIEW_REQUIRED" || assessment.additional_concerns.length > 0) && <div>
          <Button variant="secondary" isDisabled={busy || reviewSent || !patientId} onPress={() => void requestReview()}>
            {reviewSent ? "Отправлено на проверку" : "Отправить на проверку"}
          </Button>
        </div>}
        <Hint><a className="text-[var(--accent)] underline" href={assessment.source_url} target="_blank" rel="noreferrer">Финальная таблица MEWS, рисунки 3–4 (BMJ Medicine)</a></Hint>
      </ResultPanel>}
    </FormCard>
    <SideCard title="Учебная оценка матери">
      <p className="m-0">Применяется при явно подтверждённой беременности или в первые 4 недели после родов. Пол и палата не определяют применимость.</p>
      <p className="m-0">Оценка не является диагнозом. Она не создаёт и не запускает экстренное оповещение.</p>
      <p className="m-0"><a className="text-[var(--accent)] underline" href={assessment?.scope_source_url ?? "https://www.england.nhs.uk/long-read/the-maternal-care-bundle/"}
        target="_blank" rel="noreferrer">Область применения: NHS England, раздел 2.1</a></p>
    </SideCard>
  </SimLayout>;
}
