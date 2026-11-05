import { useEffect, useState, type FormEvent } from "react";

import { ApiError, getSimulatorWards, raiseAlert, type AlertSource, type Priority, type SimulatorWard } from "./api";

type Notice = { kind: "ok" | "error"; text: string } | null;

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
      <p className="hint">
        Только для демонстрации: заменяет монитор пациента и кнопку вызова. Оповещение появляется на посту медсестры
        палаты за секунду; HIGH и CRITICAL без подтверждения через 30 секунд уходят свободной медсестре.
      </p>
      {notice && (
        <p className={`notice notice-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>
          {notice.text}
        </p>
      )}
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
        <label>
          Источник
          <select value={source} onChange={(e) => setSource(e.target.value as AlertSource)}>
            <option value="MONITOR">монитор пациента</option>
            <option value="CALL_BUTTON">кнопка вызова</option>
          </select>
        </label>
        <label>
          Приоритет
          <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            <option value="CRITICAL">CRITICAL — критическое</option>
            <option value="HIGH">HIGH — высокое</option>
            <option value="LOW">LOW — низкое (без эскалации)</option>
          </select>
        </label>
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
    </div>
  );
}
