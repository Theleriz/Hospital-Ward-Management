import { useEffect, useRef, useState } from "react";

import {
  acknowledgeAlert,
  ApiError,
  getAlerts,
  getMyNurse,
  setMyStatus,
  type Alert,
  type AlertBoard,
  type NurseInfo,
  type NurseStatus,
  type Priority,
} from "./api";
import { SoundOffIcon, SoundOnIcon } from "./icons";
import { playAlertSound } from "./sound";
import { Stat } from "./WardBoard";

// NFR-01: an alert must be on screen within 2 seconds
const POLL_MS = 1000;
const ESCALATE_AFTER_S = 30;

const PRIORITY_LABELS: Record<Priority, string> = { CRITICAL: "Критическое", HIGH: "Высокое", LOW: "Низкое" };
const STATUS_LABELS: Record<NurseStatus, string> = { Available: "Принимаю вызовы", Busy: "Занят(а)", OffShift: "Не на смене" };
const SOURCE_LABELS = { MONITOR: "монитор", CALL_BUTTON: "кнопка вызова" };

const SOUND_KEY = "medbase:sound";

function readSoundSetting(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds} с`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} мин ${String(seconds % 60).padStart(2, "0")} с`;
  return `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`;
}

function responseSeconds(alert: Alert): number {
  return Math.round((Date.parse(alert.acknowledged_at!) - Date.parse(alert.created_at)) / 1000);
}

function averageResponse(alerts: Alert[]): string {
  if (!alerts.length) return "реакция —";
  const total = alerts.reduce((sum, a) => sum + responseSeconds(a), 0);
  return `средняя реакция ${formatAge(Math.round(total / alerts.length))}`;
}

/** Nurse workstation: alerts of my wards, acknowledgement, my status (UC-5 to UC-7). */
export default function NursePost({ headNurse }: { headNurse: boolean }) {
  const [board, setBoard] = useState<AlertBoard | null>(null);
  const [nurse, setNurse] = useState<NurseInfo | null>(null);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sound, setSound] = useState(readSoundSetting);
  const seen = useRef<Set<string> | null>(null);
  const soundRef = useRef(sound);
  soundRef.current = sound;

  useEffect(() => {
    getMyNurse().then(setNurse).catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const data = await getAlerts();
        if (cancelled) return;
        // Sound only for alerts that appeared after the screen was opened
        const known = seen.current;
        const fresh = known ? data.open.filter((a) => !known.has(a.alert_id) && a.priority !== "LOW") : [];
        seen.current = new Set([...(known ?? []), ...data.open.map((a) => a.alert_id)]);
        if (fresh.length && soundRef.current) {
          playAlertSound(fresh.some((a) => a.priority === "CRITICAL") ? "CRITICAL" : "HIGH");
        }
        setBoard(data);
        setOffline(false);
      } catch {
        if (!cancelled) setOffline(true);
      }
    };
    void poll();
    const timer = window.setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  function toggleSound() {
    const next = !sound;
    setSound(next);
    try {
      localStorage.setItem(SOUND_KEY, next ? "on" : "off");
    } catch {
      // Private mode: the setting lives until reload
    }
    if (next) playAlertSound("HIGH");
  }

  async function changeStatus(status: NurseStatus) {
    try {
      setNurse(await setMyStatus(status));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Сервер недоступен");
    }
  }

  async function acknowledge(alert: Alert) {
    try {
      await acknowledgeAlert(alert.alert_id);
      setError(null);
      setBoard(await getAlerts());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Сервер недоступен");
    }
  }

  const critical = board?.open.filter((a) => a.priority === "CRITICAL").length ?? 0;
  const escalated = board?.open.filter((a) => a.status === "ESCALATED").length ?? 0;

  return (
    <div className="stack">
      <section className="card post-head">
        <div>
          <strong>{nurse?.full_name ?? "…"}</strong>
          <span className="hint block">
            {headNurse
              ? "Все палаты отделения"
              : nurse?.wards.length
                ? `Палаты: ${nurse.wards.map((w) => `${w.ward_name}${w.is_primary ? " (основная)" : ""}`).join(", ")}`
                : "Палаты не назначены"}
          </span>
        </div>
        <div className="post-controls">
          <div className="segmented" role="group" aria-label="Мой статус">
            {(["Available", "Busy", "OffShift"] as NurseStatus[]).map((s) => (
              <button
                key={s}
                type="button"
                className={nurse?.status === s ? `segment segment-active status-${s}` : "segment"}
                aria-pressed={nurse?.status === s}
                onClick={() => changeStatus(s)}
              >
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>
          <button type="button" className="secondary toggle" onClick={toggleSound} aria-pressed={sound}>
            {sound ? <SoundOnIcon size={18} /> : <SoundOffIcon size={18} />}
            {sound ? "Звук включён" : "Звук выключен"}
          </button>
        </div>
      </section>

      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      {offline && (
        <p className="notice notice-error" role="alert">
          Нет связи с сервером, список может быть устаревшим
        </p>
      )}

      {board && (
        <div className="stats">
          <Stat label="Активные" value={board.open.length} sub={headNurse ? "по отделению" : "в ваших палатах"} />
          <Stat
            label="Критические"
            value={critical}
            tone={critical ? "down" : undefined}
            sub={critical ? "требуют реакции сейчас" : "нет"}
          />
          <Stat
            label="Эскалированы"
            value={escalated}
            tone={escalated ? "warn" : undefined}
            sub="не подтверждены за 30 с"
          />
          <Stat label="Подтверждено за час" value={board.recent.length} tone="ok" sub={averageResponse(board.recent)} />
        </div>
      )}

      <section>
        <div className="section-head">
          <h2>Активные оповещения</h2>
          {board ? (
            <span className="hint live">обновляется каждую секунду</span>
          ) : (
            <span className="hint">загрузка…</span>
          )}
        </div>
        {board && board.open.length === 0 && <p className="card empty">Активных оповещений нет</p>}
        <div className="alert-list" aria-live="polite">
          {board?.open.map((alert) => (
            <AlertCard key={alert.alert_id} alert={alert} onAcknowledge={() => acknowledge(alert)} />
          ))}
        </div>
      </section>

      {board && board.recent.length > 0 && (
        <section className="card">
          <h2>Подтверждены за последний час</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Оповещение</th>
                  <th>Палата</th>
                  <th>Приоритет</th>
                  <th>Подтвердил(а)</th>
                  <th>Время реакции</th>
                </tr>
              </thead>
              <tbody>
                {board.recent.map((a) => (
                  <tr key={a.alert_id}>
                    <td>
                      {a.alert_id}
                      <span className="hint block">{a.description}</span>
                    </td>
                    <td>{a.ward_name}</td>
                    <td>
                      <span className={`priority priority-${a.priority}`}>{PRIORITY_LABELS[a.priority]}</span>
                    </td>
                    <td>
                      {a.acknowledged_by_name}
                      {a.escalated_to_id && <span className="hint block">после эскалации</span>}
                    </td>
                    <td className="num">{formatAge(responseSeconds(a))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function AlertCard({ alert, onAcknowledge }: { alert: Alert; onAcknowledge: () => void }) {
  const [busy, setBusy] = useState(false);
  // HIGH/CRITICAL move on after 30 s: from creation, or from the last escalation (repeat escalation).
  // Both times come from the server, so the browser clock does not matter.
  const escalates = alert.priority !== "LOW" && alert.status !== "ACKNOWLEDGED";
  const escalatedAfter = alert.escalated_at
    ? Math.round((Date.parse(alert.escalated_at) - Date.parse(alert.created_at)) / 1000)
    : 0;
  const left = ESCALATE_AFTER_S - (alert.age_seconds - escalatedAfter);
  const next = alert.status === "ESCALATED" ? "следующей медсестре" : "эскалация";

  return (
    <article className={`card alert alert-${alert.priority}${alert.mine ? "" : " alert-other"}`}>
      <div className="alert-main">
        <div className="alert-title">
          <span className={`priority priority-${alert.priority}`}>{PRIORITY_LABELS[alert.priority]}</span>
          <strong>{alert.description ?? "Оповещение"}</strong>
        </div>
        <p className="alert-meta">
          {alert.ward_name}
          {alert.patient_name && ` · ${alert.patient_name}`} · {SOURCE_LABELS[alert.source]} · {alert.alert_id}
        </p>
        <p className="alert-meta">
          Назначено: {alert.assigned_nurse_name ?? "никому (нет медсестры на смене)"}
          {alert.status === "ESCALATED" && (
            <span className="escalated"> · эскалировано: {alert.escalated_to_name}</span>
          )}
          {escalates &&
            (left > 0 ? (
              <span className="hint">
                {" "}
                · {next} через {left} с
              </span>
            ) : (
              <span className="escalated"> · ждёт свободную медсестру для эскалации</span>
            ))}
        </p>
      </div>
      <div className="alert-side">
        <span className="alert-age" title="Сколько прошло с момента оповещения">
          {formatAge(alert.age_seconds)}
        </span>
        {alert.can_acknowledge && (
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onAcknowledge();
              setBusy(false);
            }}
          >
            Подтвердить
          </button>
        )}
      </div>
    </article>
  );
}
