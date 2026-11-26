import { Button } from "@heroui/react";
import { useState, type FormEvent } from "react";

import { ApiError, assessPews, submitStaffReview, type PewsAssessment, type PewsInput, type SimulatorWard } from "./api";
import { CheckField, ChoiceField, Field, FormCard, Hint, ResultPanel, ScoreTable, SideCard, SimLayout, Wide } from "./fields";
import { Notice } from "./ui";

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

  return <SimLayout>
    <FormCard title="PEWS NHS England — учебная оценка ребёнка в стационаре" onSubmit={assess}>
      {error && <Wide><Notice kind="error">{error}</Notice></Wide>}
      {notice && <Wide><Notice kind="ok">{notice}</Notice></Wide>}
      <ChoiceField label="Палата" value={wardId} onChange={selectWard} isRequired
        placeholder="Выберите палату"
        options={wards.map((item) => [String(item.ward_id), item.ward_name] as const)} />
      <ChoiceField label="Пациент" value={patientId} isRequired
        onChange={(value) => { setPatientId(value); setAssessment(null); setReviewSent(false); }}
        placeholder="Выберите госпитализированного пациента"
        options={ward?.patients.map((item) => [String(item.patient_id), item.full_name] as const) ?? []}
        hint={typeof selectedPatient?.age_days === "number" && selectedPatient.age_days >= 0 && selectedPatient.age_days <= 27
          ? `Новорождённый · ${selectedPatient.age_days} дней` : undefined} />
      <Wide><Button variant="secondary" onPress={fillExample}>Заполнить вымышленный пример</Button></Wide>

      <Field label="Частота дыхания (в минуту)" type="number" min="1" max="200" step="1" value={values.respiratory_rate}
        onChange={(text) => setNumber("respiratory_rate", text)} />
      <ChoiceField label="Дыхательные усилия" value={values.respiratory_distress ?? ""}
        onChange={(value) => update("respiratory_distress", (value || null) as PewsInput["respiratory_distress"])}
        options={[["", "не указано"], ["NONE", "нет"], ["MILD", "лёгкие"], ["MODERATE", "умеренные"], ["SEVERE", "тяжёлые"]]} />
      <Field label="SpO₂ (%)" type="number" min="0" max="100" step="1" value={values.spo2}
        onChange={(text) => setNumber("spo2", text)} />
      <ChoiceField label="Кислород / поддержка дыхания" value={values.oxygen_device ?? ""}
        onChange={(value) => selectOxygenDevice((value || null) as PewsInput["oxygen_device"])}
        options={[["", "не указано"], ["AIR", "воздух без кислорода"], ["OXYGEN", "кислород"], ["HIGH_FLOW", "High Flow"],
          ["BIPAP", "BiPAP"], ["CPAP", "CPAP"]]} />
      {values.oxygen_device === "OXYGEN" && <>
        <ChoiceField label="Единицы кислородной поддержки" value={values.oxygen_delivery_unit ?? ""}
          onChange={(value) => selectOxygenUnit((value || null) as PewsInput["oxygen_delivery_unit"])}
          options={[["", "не указано"], ["PERCENT", "FiO₂, %"], ["L_MIN", "поток, л/мин"]]} />
        {values.oxygen_delivery_unit === "PERCENT" && <Field label="FiO₂ по назначению (%)" type="number" min="1" max="100" step="1"
          value={values.oxygen_delivery_pct} onChange={(text) => setNumber("oxygen_delivery_pct", text)} />}
        {values.oxygen_delivery_unit === "L_MIN" && <Field label="Поток кислорода (л/мин; значения из таблицы)" type="number"
          min="0.001" max="15" step="any" value={values.oxygen_delivery_lpm} onChange={(text) => setNumber("oxygen_delivery_lpm", text)} />}
      </>}
      {values.oxygen_device && ["HIGH_FLOW", "BIPAP", "CPAP"].includes(values.oxygen_device) &&
        <Wide><Hint>По таблице NHS England High Flow, BiPAP и CPAP дают 4 балла за кислородную поддержку независимо от процента.</Hint></Wide>}
      <Field label="Пульс (уд/мин)" type="number" min="1" max="300" step="1" value={values.heart_rate}
        onChange={(text) => setNumber("heart_rate", text)} />
      <ChoiceField label="Систолическое давление или код из таблицы" value={values.systolic_code ?? "MEASURED"}
        onChange={(value) => selectSystolicCode(value as PewsInput["systolic_code"] | "MEASURED")}
        options={[["MEASURED", "давление измерено"], ["NCO", "NCO — не измеряли, беспокойства нет (0)"],
          ["U0", "U0 — не удалось измерить, беспокойства нет (0)"], ["U4", "U4 — не удалось измерить, есть беспокойство (4)"]]} />
      {values.systolic_code === null && <Field label="Систолическое давление (мм рт. ст.)" type="number" min="1" max="300" step="1"
        value={values.systolic} onChange={(text) => setNumber("systolic", text)} />}
      <Field label="Капиллярное наполнение (секунды)" type="number" min="0" max="30" step="1" value={values.crt_seconds}
        onChange={(text) => setNumber("crt_seconds", text)} />
      <Field label="Температура (°C) — отдельный сигнал таблицы" type="number" min="25" max="45" step="0.1" value={values.temperature}
        onChange={(text) => setNumber("temperature", text)} />
      <ChoiceField label="Способ измерения температуры" value={values.temperature_route ?? ""}
        onChange={(value) => update("temperature_route", (value || null) as PewsInput["temperature_route"])}
        options={[["", "не указано"], ["AXILLA", "подмышечный"], ["TYMPANIC", "ушной"], ["SKIN", "кожный"]]} />
      <ChoiceField label="Сознание по AVPU — отдельный сигнал" value={values.avpu ?? ""}
        onChange={(value) => update("avpu", (value || null) as PewsInput["avpu"])}
        options={[["", "не указано"], ["A", "A — в сознании"], ["V", "V — реакция на голос"], ["P", "P — реакция на боль"],
          ["U", "U — нет реакции"]]} />
      {(["sepsis_suspected", "septic_shock_suspected", "clinical_intuition"] as const).map((key) => (
        <ChoiceField key={key}
          label={key === "sepsis_suspected" ? "Новое подозрение на сепсис" : key === "septic_shock_suspected"
            ? "Подозрение на септический шок" : "Клиническая интуиция: ребёнку становится хуже"}
          value={values[key] === null ? "" : values[key] ? "yes" : "no"}
          onChange={(value) => update(key, value === "" ? null : value === "yes")}
          options={[["", "не указано"], ["no", "нет"], ["yes", "да"]]} />
      ))}
      <ChoiceField label="Ответ ребёнка/родителя на вопрос об изменении состояния" value={values.carer_response ?? ""}
        onChange={(value) => update("carer_response", (value || null) as PewsInput["carer_response"])}
        options={[["", "не указано"], ["W", "W — хуже"], ["S", "S — без изменений"], ["B", "B — лучше"],
          ["A", "A — родитель спит"], ["U", "U — недоступен"]]} />
      <Wide>
        <fieldset className="m-0 flex flex-col gap-2.5 rounded-xl border border-[var(--border)] p-4">
          <legend className="px-1 text-sm font-medium text-[var(--text)]">Факторы риска из таблицы</legend>
          {RISK_FACTORS.map(([key, label]) => (
            <CheckField key={key} isDisabled={values.risk_factors_confirmed !== true}
              checked={(values.risk_factors ?? []).includes(key)}
              onChange={(checked) => update("risk_factors", checked
                ? [...(values.risk_factors ?? []), key] : (values.risk_factors ?? []).filter((item) => item !== key))}>
              {label}
            </CheckField>
          ))}
          <CheckField checked={values.risk_factors_confirmed === true} className="mt-1 font-medium"
            onChange={(checked) => { update("risk_factors_confirmed", checked); if (!checked) update("risk_factors", null); else update("risk_factors", []); }}>
            Проверка факторов риска завершена
          </CheckField>
        </fieldset>
      </Wide>
      <Wide>
        <CheckField checked={values.measurement_confirmed} onChange={(checked) => update("measurement_confirmed", checked)}>
          Достоверность учебных измерений подтверждена
        </CheckField>
      </Wide>
      <Wide><Button type="submit" isDisabled={busy || !patientId}>{busy ? "Проверка…" : "Рассчитать PEWS"}</Button></Wide>

      {assessment && <ResultPanel title={assessment.status === "REVIEW_REQUIRED" ? "Нужна проверка персоналом" : "Результат PEWS"}>
        {assessment.chart_name && <p className="m-0">Выбрана таблица: <strong>{assessment.chart_name}</strong></p>}
        {assessment.status === "CLASSIFIED" && <p className="m-0">Сумма PEWS: <strong className="text-lg">{assessment.score}</strong>
          {assessment.risk_band && ` · уровень по таблице NHS: ${assessment.risk_band}`}</p>}
        <p className="m-0">{assessment.reason}</p>
        {assessment.signals.map((signal) => <Notice kind="error" key={signal}>{signal}</Notice>)}
        {assessment.status === "REVIEW_REQUIRED" && <div className="flex flex-col items-start gap-2">
          <p className="m-0">Число баллов не рассчитывается. Заявка врачу сохраняется только по нажатию и не создаёт экстренное оповещение.</p>
          <Button variant="secondary" isDisabled={busy || reviewSent || !patientId} onPress={() => void requestReview()}>
            {reviewSent ? "Отправлено на проверку" : "Отправить на проверку"}
          </Button>
        </div>}
        {assessment.status === "CLASSIFIED" && <ScoreTable rows={Object.entries(assessment.component_scores).map(([key, score]) =>
          [COMPONENTS[key] ?? key, score] as [string, number])} />}
        <Hint><a className="text-[var(--accent)] underline" href={assessment.source_url} target="_blank" rel="noreferrer">Оригинальная таблица NHS England</a></Hint>
      </ResultPanel>}
    </FormCard>
    <SideCard title="Учебная оценка">
      <p className="m-0">Сервер выбирает таблицу по дате рождения, активной госпитализации и явному типу палаты. Поддерживается только общая палата Paediatrics.</p>
      <p className="m-0">Температура, AVPU, подозрение на сепсис, клиническая интуиция, ответ ребёнка/родителя и факторы риска отображаются отдельно от суммы. Низкий PEWS их не скрывает.</p>
      <p className="m-0">PEWS не является диагнозом. Этот экран не создаёт и не запускает экстренное оповещение.</p>
    </SideCard>
  </SimLayout>;
}
