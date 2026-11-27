import { Button, Card, Chip, Tabs } from "@heroui/react";
import { useEffect, useState, type FormEvent } from "react";

import { ApiError, getSimulatorWards, raiseAlert, type AlertSource, type Priority, type SimulatorWard } from "./api";
import { ChoiceCards, ChoiceField, Field, FormCard, SideCard, SimLayout, Wide, type Choice } from "./fields";
import MaternalMewsSimulator from "./MaternalMewsSimulator";
import News2Simulator from "./News2Simulator";
import PewsSimulator from "./PewsSimulator";
import { Notice } from "./ui";

type NoticeState = { kind: "ok" | "error"; text: string } | null;
type Mode = "MANUAL" | "NEWS2" | "PEWS" | "MATERNAL_MEWS";

const MODES: Choice<Mode>[] = [
  { value: "MANUAL", label: "Ручной сценарий", hint: "существующий симулятор с выбранным приоритетом" },
  { value: "NEWS2", label: "NEWS2 по показателям", hint: "сервер рассчитывает баллы и приоритет" },
  { value: "PEWS", label: "Детский PEWS", hint: "учебная оценка для общих детских палат" },
  { value: "MATERNAL_MEWS", label: "Акушерский MEWS", hint: "учебная оценка матери при беременности и после родов" },
];

const SOURCES: Choice<AlertSource>[] = [
  { value: "MONITOR", label: "Монитор пациента", hint: "показатели вышли за границы" },
  { value: "CALL_BUTTON", label: "Кнопка вызова", hint: "пациент зовёт медсестру" },
];

const PRIORITY_COLORS: Record<Priority, "danger" | "warning" | "default"> = {
  CRITICAL: "danger",
  HIGH: "warning",
  LOW: "default",
};

const PRIORITIES: Choice<Priority>[] = [
  { value: "CRITICAL", hint: "угроза жизни" },
  { value: "HIGH", hint: "нужна помощь скоро" },
  { value: "LOW", hint: "без эскалации" },
].map((p) => ({
  ...p,
  value: p.value as Priority,
  label: (
    <Chip size="sm" variant="soft" color={PRIORITY_COLORS[p.value as Priority]} className="font-bold">
      {p.value}
    </Chip>
  ),
}));

/** Demo stand-in for patient monitors and call buttons (T-26). */
export default function SimulatorPage() {
  const [mode, setMode] = useState<Mode>("MANUAL");
  const [news2Busy, setNews2Busy] = useState(false);
  const [wards, setWards] = useState<SimulatorWard[]>([]);
  const [wardId, setWardId] = useState("");
  const [patientId, setPatientId] = useState("");
  const [source, setSource] = useState<AlertSource>("MONITOR");
  const [priority, setPriority] = useState<Priority>("CRITICAL");
  const [description, setDescription] = useState("");
  const [notice, setNotice] = useState<NoticeState>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getSimulatorWards()
      .then((data) => {
        setWards(data);
        const first = data.find((w) => w.patients.length) ?? data[0];
        if (first) {
          setWardId(String(first.ward_id));
          setPatientId(first.patients[0] ? String(first.patients[0].patient_id) : "");
        }
      })
      .catch((err) => setNotice({ kind: "error", text: err instanceof ApiError ? err.message : "Сервер недоступен" }));
  }, []);

  const ward = wards.find((w) => String(w.ward_id) === wardId);

  function chooseWard(value: string) {
    setWardId(value);
    const next = wards.find((w) => String(w.ward_id) === value);
    setPatientId(next?.patients[0] ? String(next.patients[0].patient_id) : "");
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const raised = await raiseAlert({
        ward_id: Number(wardId),
        patient_id: patientId ? Number(patientId) : null,
        source,
        priority,
        description: description.trim() || null,
      });
      setNotice({
        kind: "ok",
        text: `${raised.alert_id} создано, назначено: ${raised.assigned_nurse_id ?? "никому — в палате нет медсестры на смене"}`,
      });
    } catch (err) {
      setNotice({ kind: "error", text: err instanceof ApiError ? err.message : "Сервер недоступен" });
    } finally {
      setBusy(false);
    }
  }

  const modeControls = (
    <Card>
      <Card.Content className="flex flex-col gap-3">
        <Tabs
          selectedKey={mode}
          onSelectionChange={(key) => {
            setMode(key as Mode);
            setNotice(null);
          }}
          isDisabled={busy || news2Busy}
        >
          <Tabs.ListContainer>
            <Tabs.List aria-label="Режим симулятора">
              {MODES.map((m) => (
                <Tabs.Tab key={m.value} id={m.value}>
                  {m.label}
                  <Tabs.Indicator />
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs.ListContainer>
        </Tabs>
        <p className="m-0 text-sm text-[var(--muted)]">{MODES.find((m) => m.value === mode)?.hint}</p>
      </Card.Content>
    </Card>
  );

  const loadError = notice?.kind === "error" && <Notice kind="error">{notice.text}</Notice>;

  if (mode === "NEWS2") {
    return (
      <div className="flex flex-col gap-5">
        {modeControls}
        {loadError}
        <News2Simulator wards={wards} onBusyChange={setNews2Busy} />
      </div>
    );
  }

  if (mode === "PEWS") {
    return (
      <div className="flex flex-col gap-5">
        {modeControls}
        {loadError}
        <PewsSimulator wards={wards} />
      </div>
    );
  }

  if (mode === "MATERNAL_MEWS") {
    return (
      <div className="flex flex-col gap-5">
        {modeControls}
        {loadError}
        <MaternalMewsSimulator wards={wards} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {modeControls}
      {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
      <SimLayout>
        <FormCard title="Новое оповещение" onSubmit={onSubmit}>
          <ChoiceField
            label="Палата"
            value={wardId}
            onChange={chooseWard}
            options={wards.map((w) => [String(w.ward_id), w.ward_name] as const)}
            isRequired
            hint={`Получит: ${ward ? (ward.nurse_on_duty ?? "никто — нет медсестры на смене") : "…"}`}
          />
          <ChoiceField
            label="Пациент"
            value={patientId}
            onChange={setPatientId}
            options={[
              ...(ward?.patients.map((p) => [String(p.patient_id), p.full_name] as const) ?? []),
              ["", "без пациента (кнопка в коридоре)"] as const,
            ]}
          />
          <Wide>
            <ChoiceCards label="Источник" value={source} onChange={setSource} choices={SOURCES} />
          </Wide>
          <Wide>
            <ChoiceCards label="Приоритет" value={priority} onChange={setPriority} choices={PRIORITIES} />
          </Wide>
          <Field
            className="md:col-span-2"
            label="Описание (необязательно)"
            value={description}
            onChange={setDescription}
            maxLength={200}
            placeholder="по умолчанию — типовое для источника и приоритета"
          />
          <Wide>
            <Button type="submit" isDisabled={busy || !wardId}>
              {busy ? "Отправка…" : "Создать оповещение"}
            </Button>
          </Wide>
        </FormCard>

        <SideCard title="Как это работает">
          <p className="m-0">
            Только для демонстрации: экран заменяет монитор пациента и кнопку вызова. Оповещение появляется на посту
            медсестры палаты при обновлении списка.
          </p>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            <li className="flex items-start gap-3">
              <Chip size="sm" variant="soft" color="danger" className="shrink-0">
                Critical
              </Chip>
              <span>звук на посту; через 30 с без подтверждения — эскалация по правилам отделения</span>
            </li>
            <li className="flex items-start gap-3">
              <Chip size="sm" variant="soft" color="warning" className="shrink-0">
                High
              </Chip>
              <span>звук на посту; эскалация через 30 с, как у критического</span>
            </li>
            <li className="flex items-start gap-3">
              <Chip size="sm" variant="soft" className="shrink-0">
                Low
              </Chip>
              <span>без звука и без эскалации, ждёт медсестру палаты</span>
            </li>
          </ul>
        </SideCard>
      </SimLayout>
    </div>
  );
}
