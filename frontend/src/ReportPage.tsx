import { Fragment, useCallback, useEffect, useState } from "react";

import {
  ApiError,
  getAlertJournal,
  getAlertReport,
  type AlertJournalEvent,
  type AlertReport,
  type AlertStatus,
  type HistoryAlert,
  type Priority,
} from "./api";
import { ChevronIcon, RefreshIcon } from "./icons";
import { Stat } from "./WardBoard";

const REFRESH_MS = 30_000;

const PERIODS = [
  { hours: 12, label: "Смена · 12 ч" },
  { hours: 24, label: "Сутки" },
  { hours: 24 * 7, label: "7 дней" },
  { hours: 24 * 30, label: "30 дней" },
];

const PRIORITY_LABELS: Record<Priority, string> = { CRITICAL: "Критическое", HIGH: "Высокое", LOW: "Низкое" };

const STATUS_LABELS: Record<AlertStatus, string> = {
  PENDING: "ждёт",
  ESCALATED: "эскалировано",
  ACKNOWLEDGED: "подтверждено",
};

const STATUS_BADGES: Record<AlertStatus, string> = {
  PENDING: "badge badge-warn",
  ESCALATED: "badge badge-down",
  ACKNOWLEDGED: "badge badge-ok",
};

const EVENT_LABELS: Record<AlertJournalEvent["event_type"], string> = {
  CREATED: "Создано устройством",
  ASSIGNED: "Назначено",
  ESCALATED: "Эскалировано",
  ACKNOWLEDGED: "Подтверждено",
};

type StatusFilter = "all" | "open" | "escalated" | "acknowledged";

const DATE_TIME = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const TIME = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** "12 с", "5 мин 03 с", "2 ч 05 мин"; "—" when there is nothing to show */
export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  const s = Math.round(seconds);
  if (s < 60) return `${s} с`;
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return `${minutes} мин ${String(s % 60).padStart(2, "0")} с`;
  return `${Math.floor(minutes / 60)} ч ${String(minutes % 60).padStart(2, "0")} мин`;
}

function percent(part: number, whole: number): string {
  return whole ? `${Math.round((part / whole) * 100)}%` : "—";
}

/** Head nurse report: response times, escalations, alert history (UC-8). */
export default function ReportPage() {
  const [hours, setHours] = useState(12);
  const [report, setReport] = useState<AlertReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (period: number) => {
    setLoading(true);
    try {
      setReport(await getAlertReport(period));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Сервер недоступен, показаны последние загруженные данные");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(hours);
    const timer = window.setInterval(() => void load(hours), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [hours, load]);

  const shown = report?.hours === hours ? report : null;

  return (
    <div className="stack">
      <section className="card toolbar">
        <div className="segmented" role="group" aria-label="Период отчёта">
          {PERIODS.map((p) => (
            <button
              key={p.hours}
              type="button"
              className={hours === p.hours ? "segment segment-active segment-accent" : "segment"}
              aria-pressed={hours === p.hours}
              onClick={() => setHours(p.hours)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="toolbar-side">
          <span className="hint">
            {report ? `обновлено в ${TIME.format(new Date(report.generated_at))}` : "загрузка…"}
          </span>
          <button
            type="button"
            className="secondary toggle"
            onClick={() => void load(hours)}
            disabled={loading}
            aria-label="Обновить отчёт"
          >
            <RefreshIcon size={18} />
            Обновить
          </button>
        </div>
      </section>

      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}

      {!shown ? (
        <p className="card empty">{error ? "Не удалось загрузить отчёт" : "Загрузка отчёта…"}</p>
      ) : (
        <>
          <Summary report={shown} />
          <div className="report-grid">
            <ByPriority report={shown} />
            <ByNurse report={shown} />
          </div>
          <History report={shown} />
        </>
      )}
    </div>
  );
}

function Summary({ report }: { report: AlertReport }) {
  const { summary: s, target_seconds: target } = report;
  const slow = s.avg_response_seconds !== null && s.avg_response_seconds > target;
  return (
    <div className="stats">
      <Stat label="Оповещений" value={s.total} sub={s.open ? `${s.open} ещё не подтверждено` : "все подтверждены"} />
      <Stat
        label="Среднее время реакции"
        value={formatDuration(s.avg_response_seconds)}
        tone={s.avg_response_seconds === null ? undefined : slow ? "warn" : "ok"}
        sub={`медиана ${formatDuration(s.median_response_seconds)} · макс. ${formatDuration(s.max_response_seconds)}`}
      />
      <Stat
        label={`Подтверждено за ${target} с`}
        value={percent(s.within_target, s.acknowledged)}
        sub={`${s.within_target} из ${s.acknowledged} подтверждённых`}
      />
      <Stat
        label="Эскалировано"
        value={s.escalated}
        tone={s.escalated ? "down" : "ok"}
        sub={s.total ? `${percent(s.escalated, s.total)} от всех оповещений` : "оповещений не было"}
      />
    </div>
  );
}

function ByPriority({ report }: { report: AlertReport }) {
  return (
    <section className="card">
      <h2>По приоритетам</h2>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Приоритет</th>
              <th className="num-col">Всего</th>
              <th className="num-col">Подтв.</th>
              <th className="num-col">Эскал.</th>
              <th className="num-col">Реакция</th>
            </tr>
          </thead>
          <tbody>
            {report.by_priority.map((r) => (
              <tr key={r.priority}>
                <td>
                  <span className={`priority priority-${r.priority}`}>{PRIORITY_LABELS[r.priority]}</span>
                </td>
                <td className="num num-col">{r.total}</td>
                <td className="num num-col">{r.acknowledged}</td>
                <td className={`num num-col${r.escalated ? " text-down" : ""}`}>{r.escalated}</td>
                <td className="num num-col">
                  <Response seconds={r.avg_response_seconds} target={report.target_seconds} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ByNurse({ report }: { report: AlertReport }) {
  return (
    <section className="card">
      <h2>По медсёстрам</h2>
      {report.by_nurse.length === 0 ? (
        <p className="empty">За период оповещений не было</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Медсестра</th>
                <th className="num-col" title="Оповещения, назначенные медсестре первой">
                  Назнач.
                </th>
                <th className="num-col">Подтв.</th>
                <th className="num-col">Реакция</th>
                <th className="num-col" title="Назначенные ей, но ушедшие другой медсестре после 30 с">
                  Ушло
                </th>
                <th className="num-col" title="Пришли ей эскалацией от другой медсестры">
                  Пришло
                </th>
              </tr>
            </thead>
            <tbody>
              {report.by_nurse.map((n) => (
                <tr key={n.nurse_id}>
                  <td>
                    {n.full_name}
                    <span className="hint block">{n.nurse_id}</span>
                  </td>
                  <td className="num num-col">{n.assigned}</td>
                  <td className="num num-col">{n.acknowledged}</td>
                  <td className="num num-col">
                    <Response seconds={n.avg_response_seconds} target={report.target_seconds} />
                  </td>
                  <td className={`num num-col${n.escalated_away ? " text-down" : ""}`}>{n.escalated_away}</td>
                  <td className="num num-col">{n.received_escalations}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="hint table-note">«Ушло» — не подтверждены за 30 с и переданы другой медсестре; «Пришло» — получены эскалацией.</p>
    </section>
  );
}

function Response({ seconds, target }: { seconds: number | null; target: number }) {
  if (seconds === null) return <span className="hint">—</span>;
  return <span className={seconds > target ? "text-warn" : "text-ok"}>{formatDuration(seconds)}</span>;
}

function History({ report }: { report: AlertReport }) {
  const [priority, setPriority] = useState<Priority | "all">("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [open, setOpen] = useState<string | null>(null);

  const alerts = report.alerts.filter(
    (a) =>
      (priority === "all" || a.priority === priority) &&
      (status === "all" ||
        (status === "open" && a.status !== "ACKNOWLEDGED") ||
        (status === "escalated" && a.was_escalated) ||
        (status === "acknowledged" && a.status === "ACKNOWLEDGED")),
  );

  return (
    <section className="card">
      <div className="section-head">
        <h2>История оповещений</h2>
        <span className="badge badge-muted">
          {alerts.length} из {report.summary.total}
        </span>
      </div>
      <div className="filters">
        <label>
          Приоритет
          <select value={priority} onChange={(e) => setPriority(e.target.value as Priority | "all")}>
            <option value="all">все</option>
            <option value="CRITICAL">критические</option>
            <option value="HIGH">высокие</option>
            <option value="LOW">низкие</option>
          </select>
        </label>
        <label>
          Статус
          <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
            <option value="all">все</option>
            <option value="open">не подтверждены</option>
            <option value="escalated">эскалированные</option>
            <option value="acknowledged">подтверждённые</option>
          </select>
        </label>
      </div>
      {report.alerts_truncated && (
        <p className="hint">Показаны последние {report.alerts.length} оповещений; сводка считает все.</p>
      )}
      {alerts.length === 0 ? (
        <p className="empty">Нет оповещений по выбранным условиям</p>
      ) : (
        <div className="table-wrap">
          <table className="table history">
            <thead>
              <tr>
                <th aria-label="Журнал" />
                <th>Время</th>
                <th>Оповещение</th>
                <th>Приоритет</th>
                <th>Кто получил и подтвердил</th>
                <th>Статус</th>
                <th className="num-col">Реакция</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((a) => (
                <HistoryRow
                  key={a.alert_id}
                  alert={a}
                  target={report.target_seconds}
                  expanded={open === a.alert_id}
                  onToggle={() => setOpen(open === a.alert_id ? null : a.alert_id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function HistoryRow({
  alert,
  target,
  expanded,
  onToggle,
}: {
  alert: HistoryAlert;
  target: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <Fragment>
      <tr className={expanded ? "row-open" : undefined} onClick={onToggle}>
        <td className="row-toggle">
          <button
            type="button"
            className="icon-button chevron"
            aria-expanded={expanded}
            aria-label={`Журнал ${alert.alert_id}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
          >
            <ChevronIcon size={16} />
          </button>
        </td>
        <td className="num">{DATE_TIME.format(new Date(alert.created_at))}</td>
        <td>
          <strong>{alert.alert_id}</strong>
          <span className="hint block">
            {alert.ward_name}
            {alert.description && ` · ${alert.description}`}
          </span>
        </td>
        <td>
          <span className={`priority priority-${alert.priority}`}>{PRIORITY_LABELS[alert.priority]}</span>
        </td>
        <td>
          <span className="path">
            {alert.assigned_nurse_name ?? "никому"}
            {alert.escalated_to_name && <span className="text-down"> → {alert.escalated_to_name}</span>}
          </span>
          {alert.acknowledged_by_name && (
            <span className="hint block">подтвердил(а): {alert.acknowledged_by_name}</span>
          )}
        </td>
        <td>
          <span className={STATUS_BADGES[alert.status]}>{STATUS_LABELS[alert.status]}</span>
        </td>
        <td className="num num-col">
          <Response seconds={alert.response_seconds} target={target} />
        </td>
      </tr>
      {expanded && (
        <tr className="journal-row">
          <td />
          <td colSpan={6}>
            <Journal alertId={alert.alert_id} />
          </td>
        </tr>
      )}
    </Fragment>
  );
}

function Journal({ alertId }: { alertId: string }) {
  const [events, setEvents] = useState<AlertJournalEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAlertJournal(alertId)
      .then(setEvents)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Сервер недоступен"));
  }, [alertId]);

  if (error) return <p className="error">{error}</p>;
  if (!events) return <p className="hint">Загрузка журнала…</p>;

  const start = Date.parse(events[0]?.occurred_at ?? "");
  return (
    <ol className="timeline" aria-label={`Журнал оповещения ${alertId}`}>
      {events.map((e) => (
        <li key={e.event_id} className={`timeline-${e.event_type}`}>
          <span className="timeline-time num">{TIME.format(new Date(e.occurred_at))}</span>
          <span>
            <strong>{EVENT_LABELS[e.event_type]}</strong>
            {e.nurse_name && ` · ${e.nurse_name}`}
            {e.event_type !== "CREATED" && (
              <span className="hint"> · через {formatDuration((Date.parse(e.occurred_at) - start) / 1000)}</span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}
