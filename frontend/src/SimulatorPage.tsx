import { useEffect, useState, type FormEvent } from "react";

import { ApiError, getSimulatorWards, raiseAlert, type AlertSource, type Priority, type SimulatorWard } from "./api";

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

  return (
    <div className="stack">
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
            медсестры палаты за секунду.
          </p>
          <ul className="legend">
            <li>
              <span className="priority priority-CRITICAL">Critical</span>
              <span>звук на посту; без подтверждения через 30 с уходит свободной медсестре</span>
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
    </div>
  );
}
