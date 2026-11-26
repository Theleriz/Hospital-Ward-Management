import { Button, Chip } from "@heroui/react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  ApiError, assessNews2Vitals, raiseNews2Alert, submitStaffReview,
  type News2Assessment, type News2Consciousness, type News2VitalSigns, type SimulatorWard,
} from "./api";
import { CheckField, ChoiceField, Field, FormCard, Hint, ResultPanel, ScoreTable, SideCard, SimLayout, Wide } from "./fields";
import { Notice } from "./ui";

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
const PRIORITY_COLORS = { CRITICAL: "danger", HIGH: "warning", LOW: "default" } as const;
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
      setPatientId("");
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
    setPatientId("");
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
    if (inFlight.current || !wardId || !patientId) return;
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
    if (inFlight.current || !wardId || !patientId || assessment?.status !== "CLASSIFIED" || !assessment.priority
        || assessedRevision.current !== revision.current) return;
    const currentRevision = revision.current;
    try {
      const vitals = payload();
      inFlight.current = true;
      setBusy("create");
      setError(null); setNotice(null);
      const raised = await raiseNews2Alert({ ward_id: Number(wardId),
        patient_id: Number(patientId), vitals });
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

  const canCreate = !!wardId && !!patientId && assessment?.status === "CLASSIFIED" && !!assessment.priority
    && assessedRevision.current === revision.current && busy === null;

  return (
    <SimLayout>
      <FormCard title="NEWS2 — учебная оценка показателей" onSubmit={assess}>
        {error && <Wide><Notice kind="error">{error}</Notice></Wide>}
        {notice && <Wide><Notice kind="ok">{notice}</Notice></Wide>}
        {!wards.length && <Wide><Hint>Список палат не загружен. Проверьте соединение с сервером.</Hint></Wide>}
        <ChoiceField
          label="Палата"
          value={wardId}
          onChange={chooseWard}
          options={wards.map((w) => [String(w.ward_id), w.ward_name] as const)}
          isRequired
          isDisabled={locked}
          hint={`Получит: ${ward?.nurse_on_duty ?? "нет медсестры палаты на смене"}`}
        />
        <ChoiceField
          label="Пациент"
          value={patientId}
          onChange={(value) => { resetEpisode(); setPatientId(value); }}
          options={ward?.patients.map((p) => [String(p.patient_id), p.full_name] as const) ?? []}
          placeholder="Выберите госпитализированного пациента"
          isRequired
          isDisabled={locked}
        />
        <Wide>
          <Button variant="secondary" isDisabled={locked} onPress={fillExample}>Заполнить учебный пример</Button>
        </Wide>
        {FIELDS.map((field) => (
          <Field key={field.key} label={field.label} type="number" value={readings[field.key]}
            min={field.min} max={field.max} step={field.step} isRequired isDisabled={locked}
            onChange={(text) => {
              invalidate(); setConfirmed(false);
              setReadings((old) => ({ ...old, [field.key]: text }));
            }} />
        ))}
        <Field label="Возраст (лет)" type="number" value={age} min={0} max={130} step={1} isDisabled={locked}
          onChange={(text) => { invalidate(); setAge(text); }} />
        <ChoiceField label="Беременность" value={pregnancy} isDisabled={locked}
          onChange={(value) => { invalidate(); setPregnancy(value); }}
          options={[["", "не указано"], ["no", "нет / неприменимо"], ["yes", "да"]]} />
        <ChoiceField label="Сознание / новая спутанность" value={consciousness} isDisabled={locked}
          onChange={(value) => { invalidate(); setConfirmed(false); setConsciousness(value as News2Consciousness | ""); }}
          options={[["", "не указано"], ["ALERT", "в ясном сознании"], ["NEW_CONFUSION", "новая или усилившаяся спутанность"],
            ["VOICE", "реагирует на голос"], ["PAIN", "реагирует на боль"], ["UNRESPONSIVE", "нет реакции"]]} />
        <ChoiceField label="Дополнительный кислород" value={oxygen} isDisabled={locked}
          onChange={(value) => { invalidate(); setConfirmed(false); setOxygen(value); }}
          options={[["", "не указано"], ["no", "нет — воздух"], ["yes", "да"]]} />
        <ChoiceField label="Шкала SpO₂" value={String(scale)} isDisabled={locked}
          onChange={(value) => { invalidate(); setConfirmed(false); setScaleConfirmed(false); setScale(Number(value) as 1 | 2); }}
          options={[["1", "Scale 1 — стандартная"], ["2", "Scale 2 — по документированному решению"]]} />
        {scale === 2 && (
          <Wide>
            <CheckField checked={scaleConfirmed} isDisabled={locked}
              onChange={(checked) => { invalidate(); setScaleConfirmed(checked); }}>
              Для учебного пациента подтверждено документированное клиническое решение о Scale 2
            </CheckField>
          </Wide>
        )}
        <Wide className="flex flex-col gap-3">
          <CheckField checked={confirmed} isDisabled={locked}
            onChange={(checked) => { invalidate(); setConfirmed(checked); }}>
            Достоверность учебных измерений подтверждена
          </CheckField>
          <CheckField checked={acute} isDisabled={locked}
            onChange={(checked) => { invalidate(); setAcute(checked); }}>
            Сообщены острые симптомы — требуется срочная оценка персоналом
          </CheckField>
        </Wide>
        <Wide>
          <Button type="submit" isDisabled={busy !== null || !wardId || !patientId}>
            {busy === "assess" ? "Расчёт…" : "Рассчитать приоритет"}
          </Button>
        </Wide>
        {assessment && (
          <ResultPanel title={assessment.status === "REVIEW_REQUIRED" ? "Нужна проверка персоналом" : "Результат оценки"}>
            {assessment.priority && (
              <p className="m-0 flex items-center gap-2">
                Приоритет MedBase:
                <Chip size="sm" variant="primary" color={PRIORITY_COLORS[assessment.priority]} className="font-bold">
                  {assessment.priority}
                </Chip>
              </p>
            )}
            {assessment.news2_score !== null && (
              <p className="m-0">
                NEWS2: <strong className="text-lg">{assessment.news2_score}</strong>
                {assessment.news2_risk && ` · риск NEWS2: ${RISK_LABELS[assessment.news2_risk]}`}
              </p>
            )}
            {assessment.classification_basis === "ACUTE_SYMPTOMS_OVERRIDE" && (
              <p className="m-0">NEWS2 не вычислен: действует отдельное правило острых симптомов.</p>
            )}
            <p className="m-0">{assessment.reason}</p>
            {assessment.status === "REVIEW_REQUIRED" && (
              <div className="flex flex-col items-start gap-2">
                <p className="m-0">Это учебная оценка, не диагноз. Заявка не вызывает экстренное оповещение.</p>
                <Button variant="secondary" isDisabled={!patientId || busy !== null || reviewSent} onPress={async () => {
                  if (!patientId || !assessment.reason) return;
                  setBusy("create"); setError(null);
                  try {
                    await submitStaffReview(Number(patientId), assessment.reason);
                    setReviewSent(true);
                  } catch (err) { setError(errorText(err)); }
                  finally { setBusy(null); }
                }}>
                  {reviewSent ? "Отправлено на проверку" : "Отправить на проверку"}
                </Button>
                {!patientId && <Hint>Выберите пациента, чтобы отправить заявку.</Hint>}
              </div>
            )}
            {Object.keys(assessment.component_scores).length > 0 && (
              <ScoreTable rows={Object.entries(assessment.component_scores).map(([name, points]) =>
                [COMPONENT_LABELS[name] ?? name, points] as [string, number])} />
            )}
          </ResultPanel>
        )}
        <Wide>
          <Button isDisabled={!canCreate} onPress={() => void createAlert()}>
            {busy === "create" ? "Создание…" : "Создать оповещение по NEWS2"}
          </Button>
        </Wide>
      </FormCard>
      <SideCard title="Учебный режим NEWS2">
        <p className="m-0">Вводите синтетические наблюдения. Приоритет рассчитывает сервер; вручную выбрать его в этом режиме нельзя.</p>
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          <li className="flex items-start gap-3"><Chip size="sm" variant="soft" color="danger" className="shrink-0">CRITICAL</Chip><span>сумма NEWS2 от 7</span></li>
          <li className="flex items-start gap-3"><Chip size="sm" variant="soft" color="warning" className="shrink-0">HIGH</Chip><span>сумма 5–6 или отдельный показатель с 3 баллами</span></li>
          <li className="flex items-start gap-3"><Chip size="sm" variant="soft" className="shrink-0">LOW</Chip><span>сумма 0–4 без отдельного показателя с 3 баллами; это не подтверждение безопасности</span></li>
        </ul>
        <p className="m-0">Острые симптомы включают отдельный CRITICAL override без расчёта NEWS2. Шкалу 2 система сама не выбирает.</p>
        <p className="m-0">Сначала выполните оценку, затем создайте оповещение. Любое изменение данных сбрасывает результат. При создании сервер рассчитывает приоритет повторно.</p>
        <p className="m-0">Сигнал обрабатывается существующим постом медсестры, механизмом эскалации и отчётом. 30 секунд — настройка учебной передачи оповещения, а не клиническая рекомендация NEWS2.</p>
      </SideCard>
    </SimLayout>
  );
}
