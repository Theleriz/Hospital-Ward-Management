import { useEffect, useState, type FormEvent } from "react";
import News2Simulator from "./News2Simulator";

import {
  ApiError,
  getSimulatorNurses,
  getSimulatorWards,
  raiseAlert,
  scanBadge,
  type AlertSource,
  type Priority,
  type SimulatorNurse,
  type SimulatorWard,
} from "./api";

type Notice = { kind: "ok" | "error"; text: string } | null;

const SOURCES: { value: AlertSource; label: string; hint: string }[] = [
  { value: "MONITOR", label: "Монитор пациента", hint: "показатели вышли за границы" },
  { value: "CALL_BUTTON", label: "Кнопка вызова", hint: "пациент зовёт медсестру" },
];

const PRIORITIES: { value: Priority; hint: string }[] = [
  { value: "CRITICAL", hint: "угроза жизни" },
  { value: "HIGH", hint: "нужна помощь скоро" },
  { value: "LOW", hint: "без эскалации" },
];

/** Demo stand-in for patient monitors and call buttons (T-26). */
export default function SimulatorPage() {
  const [mode, setMode] = useState<"MANUAL" | "NEWS2">("MANUAL");
  const [news2Busy, setNews2Busy] = useState(false);
  const [wards, setWards] = useState<SimulatorWard[]>([]);
  const [wardId, setWardId] = useState("");
  const [patientId, setPatientId] = useState("");
  const [source, setSource] = useState<AlertSource>("MONITOR");
  const [priority, setPriority] = useState<Priority>("CRITICAL");
  const [description, setDescription] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
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
    <fieldset className="card choice-field">
      <legend>Режим симулятора</legend>
      <div className="choice-group choice-group-2" role="radiogroup" aria-label="Режим симулятора">
        <button type="button" role="radio" aria-checked={mode === "MANUAL"} disabled={busy || news2Busy}
          className={mode === "MANUAL" ? "choice choice-active" : "choice"}
          onClick={() => { setMode("MANUAL"); setNotice(null); }}>
          Ручной сценарий<span>существующий симулятор с выбранным приоритетом</span>
        </button>
        <button type="button" role="radio" aria-checked={mode === "NEWS2"} disabled={busy || news2Busy}
          className={mode === "NEWS2" ? "choice choice-active" : "choice"}
          onClick={() => { setMode("NEWS2"); setNotice(null); }}>
          NEWS2 по показателям<span>сервер рассчитывает баллы и приоритет</span>
        </button>
      </div>
    </fieldset>
  );

  if (mode === "NEWS2") {
    return <div className="stack">
      {modeControls}
      {notice?.kind === "error" && <p className="notice notice-error" role="alert">{notice.text}</p>}
      <News2Simulator wards={wards} onBusyChange={setNews2Busy} />
    </div>;
  }

  return (
    <div className="stack">
      {modeControls}
      {notice && (
        <p className={`notice notice-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>
          {notice.text}
        </p>
      )}
      <div className="sim-layout">
        <form className="card form-grid" onSubmit={onSubmit}>
          <h2 className="form-title">Новое оповещение</h2>
          <label>
            Палата
            <select value={wardId} onChange={(e) => chooseWard(e.target.value)} required>
              {wards.map((w) => (
                <option key={w.ward_id} value={w.ward_id}>
                  {w.ward_name}
                </option>
              ))}
            </select>
            <span className="hint">
              Получит: {ward ? (ward.nurse_on_duty ?? "никто — нет медсестры на смене") : "…"}
            </span>
          </label>
          <label>
            Пациент
            <select value={patientId} onChange={(e) => setPatientId(e.target.value)}>
              {ward?.patients.map((p) => (
                <option key={p.patient_id} value={p.patient_id}>
                  {p.full_name}
                </option>
              ))}
              <option value="">без пациента (кнопка в коридоре)</option>
            </select>
          </label>

          <fieldset className="form-wide choice-field">
            <legend>Источник</legend>
            <div className="choice-group choice-group-2" role="radiogroup" aria-label="Источник">
              {SOURCES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  role="radio"
                  aria-checked={source === s.value}
                  className={source === s.value ? "choice choice-active" : "choice"}
                  onClick={() => setSource(s.value)}
                >
                  {s.label}
                  <span>{s.hint}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="form-wide choice-field">
            <legend>Приоритет</legend>
            <div className="choice-group" role="radiogroup" aria-label="Приоритет">
              {PRIORITIES.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  role="radio"
                  aria-checked={priority === p.value}
                  className={priority === p.value ? "choice choice-active" : "choice"}
                  onClick={() => setPriority(p.value)}
                >
                  <b className={`priority priority-${p.value}`}>{p.value}</b>
                  <span>{p.hint}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <label className="form-wide">
            Описание (необязательно)
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={200}
              placeholder="по умолчанию — типовое для источника и приоритета"
            />
          </label>
          <div className="form-wide">
            <button type="submit" disabled={busy || !wardId}>
              {busy ? "Отправка…" : "Создать оповещение"}
            </button>
          </div>
        </form>

        <aside className="card">
          <h2>Как это работает</h2>
          <p className="hint">
            Только для демонстрации: экран заменяет монитор пациента и кнопку вызова. Оповещение появляется на посту
            медсестры палаты при обновлении списка.
          </p>
          <ul className="legend">
            <li>
              <span className="priority priority-CRITICAL">Critical</span>
              <span>звук на посту; через 30 с без подтверждения — эскалация по правилам отделения</span>
            </li>
            <li>
              <span className="priority priority-HIGH">High</span>
              <span>звук на посту; эскалация через 30 с, как у критического</span>
            </li>
            <li>
              <span className="priority priority-LOW">Low</span>
              <span>без звука и без эскалации, ждёт медсестру палаты</span>
            </li>
          </ul>
        </aside>
      </div>

      <BadgeReader wards={wards} onNotice={setNotice} />
    </div>
  );
}

const STATUS_WORDS = { Available: "свободна", Busy: "занята", OffShift: "не на смене" } as const;

/**
 * Door badge readers (decisions.md, record 14): a nurse touches the reader at a ward
 * door, and the system knows where she or he is. Escalation calls the nearest nurse.
 */
function BadgeReader({ wards, onNotice }: { wards: SimulatorWard[]; onNotice: (n: Notice) => void }) {
  const [nurses, setNurses] = useState<SimulatorNurse[]>([]);
  const [nurseId, setNurseId] = useState("");
  const [doorId, setDoorId] = useState("");

  const load = () =>
    getSimulatorNurses()
      .then((data) => {
        setNurses(data);
        setNurseId((current) => current || (data.find((n) => n.status !== "OffShift")?.nurse_id ?? ""));
      })
      .catch(() => undefined);

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!doorId && wards[0]) setDoorId(String(wards[0].ward_id));
  }, [wards, doorId]);

  const wardName = (id: number | null) => wards.find((w) => w.ward_id === id)?.ward_name ?? "неизвестно";

  async function onScan(event: FormEvent) {
    event.preventDefault();
    try {
      await scanBadge(nurseId, Number(doorId));
      const nurse = nurses.find((n) => n.nurse_id === nurseId);
      onNotice({ kind: "ok", text: `${nurse?.full_name ?? nurseId} теперь в палате «${wardName(Number(doorId))}»` });
      await load();
    } catch (err) {
      onNotice({ kind: "error", text: err instanceof ApiError ? err.message : "Сервер недоступен" });
    }
  }

  return (
    <div className="sim-layout">
      <form className="card form-grid" onSubmit={onScan}>
        <h2 className="form-title">Считыватель бейджа у двери палаты</h2>
        <label>
          Медсестра
          <select value={nurseId} onChange={(e) => setNurseId(e.target.value)} required>
            {nurses.map((n) => (
              <option key={n.nurse_id} value={n.nurse_id} disabled={n.status === "OffShift"}>
                {n.full_name} ({STATUS_WORDS[n.status]})
              </option>
            ))}
          </select>
        </label>
        <label>
          Дверь палаты
          <select value={doorId} onChange={(e) => setDoorId(e.target.value)} required>
            {wards.map((w) => (
              <option key={w.ward_id} value={w.ward_id}>
                {w.ward_name}
              </option>
            ))}
          </select>
        </label>
        <div className="form-wide">
          <button type="submit" disabled={!nurseId || !doorId}>
            Приложить бейдж
          </button>
        </div>
      </form>

      <aside className="card">
        <h2>Где медсёстры сейчас</h2>
        <ul className="map-nurses">
          {nurses.map((n) => (
            <li key={n.nurse_id} className="map-nurse">
              <i className={`dot-status dot-${n.status}`} />
              <span>{n.full_name}</span>
              <span className="hint">{n.status === "OffShift" ? "не на смене" : wardName(n.current_ward_id)}</span>
            </li>
          ))}
        </ul>
        <p className="hint">Эскалация зовёт ближайшую свободную медсестру: в палате, затем на этаже.</p>
      </aside>
    </div>
  );
}
