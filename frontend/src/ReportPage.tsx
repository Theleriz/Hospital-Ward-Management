import { Button, Card, Chip, Label, ListBox, Select, ToggleButton, ToggleButtonGroup } from "@heroui/react";
import { Fragment, useCallback, useEffect, useState, type Key, type ReactNode } from "react";

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
import { Notice, StatCard } from "./ui";

const REFRESH_MS = 30_000;

const PERIODS = [
  { hours: 12, label: "Смена · 12 ч" },
  { hours: 24, label: "Сутки" },
  { hours: 24 * 7, label: "7 дней" },
  { hours: 24 * 30, label: "30 дней" },
];

const PRIORITY_LABELS: Record<Priority, string> = { CRITICAL: "Критическое", HIGH: "Высокое", LOW: "Низкое" };
const PRIORITY_COLORS: Record<Priority, "danger" | "warning" | "default"> = {
  CRITICAL: "danger",
  HIGH: "warning",
  LOW: "default",
};

const STATUS_LABELS: Record<AlertStatus, string> = {
  PENDING: "ждёт",
  ESCALATED: "эскалировано",
  ACKNOWLEDGED: "подтверждено",
};
const STATUS_COLORS: Record<AlertStatus, "warning" | "danger" | "success"> = {
  PENDING: "warning",
  ESCALATED: "danger",
  ACKNOWLEDGED: "success",
};

const EVENT_LABELS: Record<AlertJournalEvent["event_type"], string> = {
  CREATED: "Создано устройством",
  ASSIGNED: "Назначено",
  ESCALATED: "Эскалировано",
  ACKNOWLEDGED: "Подтверждено",
};
// Dot colour of each event on the journal timeline
const EVENT_DOTS: Record<AlertJournalEvent["event_type"], string> = {
  CREATED: "bg-[var(--muted)]",
  ASSIGNED: "bg-[var(--accent)]",
  ESCALATED: "bg-[var(--down)]",
  ACKNOWLEDGED: "bg-[var(--ok)]",
};

type StatusFilter = "all" | "open" | "escalated" | "acknowledged";

const PRIORITY_FILTERS: { id: Priority | "all"; label: string }[] = [
  { id: "all", label: "все" },
  { id: "CRITICAL", label: "критические" },
  { id: "HIGH", label: "высокие" },
  { id: "LOW", label: "низкие" },
];
const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "все" },
  { id: "open", label: "не подтверждены" },
  { id: "escalated", label: "эскалированные" },
  { id: "acknowledged", label: "подтверждённые" },
];

const DATE_TIME = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const TIME = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

// Table styling shared by the report tables (plain tables: history rows open a journal)
const TH = "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[var(--muted)]";
const TH_NUM = `${TH} text-right`;
const TD = "px-4 py-3 align-middle";
const TD_NUM = `${TD} text-right tabular-nums`;

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
    <div className="flex flex-col gap-5">
      <Card>
        <Card.Content className="flex flex-row flex-wrap items-center justify-between gap-3">
          <ToggleButtonGroup
            aria-label="Период отчёта"
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={[String(hours)]}
            onSelectionChange={(keys: Set<Key>) => {
              const [next] = keys;
              if (next) setHours(Number(next));
            }}
          >
            {PERIODS.map((p) => (
              <ToggleButton
                key={p.hours}
                id={String(p.hours)}
                className="bg-[var(--surface-2)] font-semibold text-[var(--text)] hover:bg-[var(--border)] data-[selected=true]:!bg-[var(--accent)] data-[selected=true]:!text-white"
              >
                {p.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <div className="flex items-center gap-3">
            <span className="text-sm text-[var(--muted)]">
              {report ? `обновлено в ${TIME.format(new Date(report.generated_at))}` : "загрузка…"}
            </span>
            <Button variant="secondary" onPress={() => void load(hours)} isDisabled={loading} aria-label="Обновить отчёт">
              <span className={loading ? "animate-spin" : undefined}>
                <RefreshIcon size={18} />
              </span>
              Обновить
            </Button>
          </div>
        </Card.Content>
      </Card>

      {error && <Notice kind="error">{error}</Notice>}

      {!shown ? (
        <Card>
          <Card.Content className="py-8 text-center text-[var(--muted)]">
            {error ? "Не удалось загрузить отчёт" : "Загрузка отчёта…"}
          </Card.Content>
        </Card>
      ) : (
        <>
          <Summary report={shown} />
          <div className="grid gap-5 2xl:grid-cols-[2fr_3fr]">
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
  const within = s.acknowledged ? Math.round((s.within_target / s.acknowledged) * 100) : 0;
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <StatCard label="Оповещений" value={s.total} sub={s.open ? `${s.open} ещё не подтверждено` : "все подтверждены"} />
      <StatCard
        label="Среднее время реакции"
        value={formatDuration(s.avg_response_seconds)}
        tone={s.avg_response_seconds === null ? undefined : slow ? "warn" : "ok"}
        sub={`медиана ${formatDuration(s.median_response_seconds)} · макс. ${formatDuration(s.max_response_seconds)}`}
      />
      <StatCard
        label={`Подтверждено за ${target} с`}
        value={percent(s.within_target, s.acknowledged)}
        sub={
          <span className="flex flex-col gap-1.5">
            <span>
              {s.within_target} из {s.acknowledged} подтверждённых
            </span>
            <Bar value={within} tone={within >= 80 ? "ok" : within >= 50 ? "warn" : "down"} />
          </span>
        }
      />
      <StatCard
        label="Эскалировано"
        value={s.escalated}
        tone={s.escalated ? "down" : "ok"}
        sub={s.total ? `${percent(s.escalated, s.total)} от всех оповещений` : "оповещений не было"}
      />
    </div>
  );
}

/** Thin progress bar, 0–100 */
function Bar({ value, tone }: { value: number; tone: "ok" | "warn" | "down" }) {
  const colour = { ok: "bg-[var(--ok)]", warn: "bg-[var(--warn)]", down: "bg-[var(--down)]" }[tone];
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-[var(--border)]" aria-hidden="true">
      <span className={`block h-full rounded-full ${colour}`} style={{ width: `${Math.min(100, value)}%` }} />
    </span>
  );
}

function ReportCard({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    // min-w-0: inside the grid the card may shrink, and its table scrolls instead of overflowing
    <Card className="min-w-0">
      <Card.Header className="flex flex-row flex-wrap items-center justify-between gap-3">
        <Card.Title render={(props) => <h2 {...props} />}>{title}</Card.Title>
        {aside}
      </Card.Header>
      <Card.Content className="flex flex-col gap-3">{children}</Card.Content>
    </Card>
  );
}

function TableFrame({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

function ByPriority({ report }: { report: AlertReport }) {
  return (
    <ReportCard title="По приоритетам">
      <TableFrame>
        <thead className="bg-[var(--surface-2)]">
          <tr>
            <th className={TH}>Приоритет</th>
            <th className={TH_NUM}>Всего</th>
            <th className={TH_NUM}>Подтв.</th>
            <th className={TH_NUM}>Эскал.</th>
            <th className={TH_NUM}>Реакция</th>
          </tr>
        </thead>
        <tbody>
          {report.by_priority.map((r) => (
            <tr key={r.priority} className="border-t border-[var(--border)]">
              <td className={TD}>
                <Chip size="sm" variant="soft" color={PRIORITY_COLORS[r.priority]}>
                  {PRIORITY_LABELS[r.priority]}
                </Chip>
              </td>
              <td className={TD_NUM}>{r.total}</td>
              <td className={TD_NUM}>{r.acknowledged}</td>
              <td className={`${TD_NUM} ${r.escalated ? "font-semibold text-[var(--down)]" : ""}`}>{r.escalated}</td>
              <td className={TD_NUM}>
                <Response seconds={r.avg_response_seconds} target={report.target_seconds} />
              </td>
            </tr>
          ))}
        </tbody>
      </TableFrame>
    </ReportCard>
  );
}

function ByNurse({ report }: { report: AlertReport }) {
  return (
    <ReportCard title="По медсёстрам">
      {report.by_nurse.length === 0 ? (
        <p className="m-0 py-4 text-center text-[var(--muted)]">За период оповещений не было</p>
      ) : (
        <TableFrame>
          <thead className="bg-[var(--surface-2)]">
            <tr>
              <th className={TH}>Медсестра</th>
              <th className={TH_NUM} title="Оповещения, назначенные медсестре первой">
                Назнач.
              </th>
              <th className={TH_NUM}>Подтв.</th>
              <th className={TH_NUM}>Реакция</th>
              <th className={TH_NUM} title="Назначенные ей, но ушедшие другой медсестре после 30 с">
                Ушло
              </th>
              <th className={TH_NUM} title="Пришли ей эскалацией от другой медсестры">
                Пришло
              </th>
            </tr>
          </thead>
          <tbody>
            {report.by_nurse.map((n) => (
              <tr key={n.nurse_id} className="border-t border-[var(--border)]">
                <td className={TD}>
                  <div className="flex flex-col">
                    <span className="whitespace-nowrap font-medium text-[var(--text)]">{n.full_name}</span>
                    <span className="text-xs text-[var(--muted)]">{n.nurse_id}</span>
                  </div>
                </td>
                <td className={TD_NUM}>{n.assigned}</td>
                <td className={TD_NUM}>{n.acknowledged}</td>
                <td className={TD_NUM}>
                  <Response seconds={n.avg_response_seconds} target={report.target_seconds} />
                </td>
                <td className={`${TD_NUM} ${n.escalated_away ? "font-semibold text-[var(--down)]" : ""}`}>
                  {n.escalated_away}
                </td>
                <td className={TD_NUM}>{n.received_escalations}</td>
              </tr>
            ))}
          </tbody>
        </TableFrame>
      )}
      <p className="m-0 text-xs text-[var(--muted)]">
        «Ушло» — не подтверждены за 30 с и переданы другой медсестре; «Пришло» — получены эскалацией.
      </p>
    </ReportCard>
  );
}

function Response({ seconds, target }: { seconds: number | null; target: number }) {
  if (seconds === null) return <span className="text-[var(--muted)]">—</span>;
  return (
    <span className={`font-medium ${seconds > target ? "text-[var(--warn)]" : "text-[var(--ok)]"}`}>
      {formatDuration(seconds)}
    </span>
  );
}

function FilterSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <Select className="w-52" selectedKey={value} onSelectionChange={(key) => key !== null && onChange(key as T)}>
      <Label>{label}</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {options.map((o) => (
            <ListBox.Item key={o.id} id={o.id} textValue={o.label}>
              {o.label}
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
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
    <ReportCard
      title="История оповещений"
      aside={
        <Chip variant="soft">
          {alerts.length} из {report.summary.total}
        </Chip>
      }
    >
      <div className="flex flex-wrap gap-3">
        <FilterSelect label="Приоритет" value={priority} options={PRIORITY_FILTERS} onChange={setPriority} />
        <FilterSelect label="Статус" value={status} options={STATUS_FILTERS} onChange={setStatus} />
      </div>
      {report.alerts_truncated && (
        <p className="m-0 text-sm text-[var(--muted)]">
          Показаны последние {report.alerts.length} оповещений; сводка считает все.
        </p>
      )}
      {alerts.length === 0 ? (
        <p className="m-0 py-4 text-center text-[var(--muted)]">Нет оповещений по выбранным условиям</p>
      ) : (
        <TableFrame>
          <thead className="bg-[var(--surface-2)]">
            <tr>
              <th className={`${TH} w-10`} aria-label="Журнал" />
              <th className={TH}>Время</th>
              <th className={TH}>Оповещение</th>
              <th className={TH}>Приоритет</th>
              <th className={TH}>Кто получил и подтвердил</th>
              <th className={TH}>Статус</th>
              <th className={TH_NUM}>Реакция</th>
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
        </TableFrame>
      )}
    </ReportCard>
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
      <tr
        className={`cursor-pointer border-t border-[var(--border)] transition-colors hover:bg-[var(--surface-2)] ${
          expanded ? "bg-[var(--surface-2)]" : ""
        }`}
        onClick={onToggle}
      >
        <td className={TD}>
          <Button
            isIconOnly
            size="sm"
            variant="ghost"
            aria-expanded={expanded}
            aria-label={`Журнал ${alert.alert_id}`}
            onPress={onToggle}
          >
            <span className={`transition-transform ${expanded ? "rotate-90" : ""}`}>
              <ChevronIcon size={16} />
            </span>
          </Button>
        </td>
        <td className={`${TD} tabular-nums`}>{DATE_TIME.format(new Date(alert.created_at))}</td>
        <td className={TD}>
          <div className="flex flex-col">
            <strong className="text-[var(--text)]">{alert.alert_id}</strong>
            <span className="text-xs text-[var(--muted)]">
              {alert.ward_name}
              {alert.description && ` · ${alert.description}`}
            </span>
          </div>
        </td>
        <td className={TD}>
          <Chip size="sm" variant="soft" color={PRIORITY_COLORS[alert.priority]}>
            {PRIORITY_LABELS[alert.priority]}
          </Chip>
        </td>
        <td className={TD}>
          <div className="flex flex-col">
            <span>
              {alert.assigned_nurse_name ?? "никому"}
              {alert.escalated_to_name && (
                <span className="font-medium text-[var(--down)]"> → {alert.escalated_to_name}</span>
              )}
            </span>
            {alert.acknowledged_by_name && (
              <span className="text-xs text-[var(--muted)]">подтвердил(а): {alert.acknowledged_by_name}</span>
            )}
          </div>
        </td>
        <td className={TD}>
          <Chip size="sm" variant="soft" color={STATUS_COLORS[alert.status]}>
            {STATUS_LABELS[alert.status]}
          </Chip>
        </td>
        <td className={TD_NUM}>
          <Response seconds={alert.response_seconds} target={target} />
        </td>
      </tr>
      {expanded && (
        <tr className="bg-[var(--surface-2)]">
          <td />
          <td colSpan={6} className="px-4 pb-4">
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

  if (error) return <p className="m-0 text-sm text-[var(--down)]">{error}</p>;
  if (!events) return <p className="m-0 text-sm text-[var(--muted)]">Загрузка журнала…</p>;

  const start = Date.parse(events[0]?.occurred_at ?? "");
  return (
    <ol className="relative m-0 ml-2 flex list-none flex-col gap-3 border-l-2 border-[var(--border)] py-1 pl-6" aria-label={`Журнал оповещения ${alertId}`}>
      {events.map((e) => (
        <li key={e.event_id} className="relative flex flex-wrap items-baseline gap-x-3 text-sm">
          <span
            aria-hidden="true"
            className={`absolute -left-[31px] top-1 size-3 rounded-full ring-4 ring-[var(--surface-2)] ${EVENT_DOTS[e.event_type]}`}
          />
          <span className="tabular-nums text-[var(--muted)]">{TIME.format(new Date(e.occurred_at))}</span>
          <span className="text-[var(--text)]">
            <strong>{EVENT_LABELS[e.event_type]}</strong>
            {e.nurse_name && ` · ${e.nurse_name}`}
            {e.event_type !== "CREATED" && (
              <span className="text-[var(--muted)]"> · через {formatDuration((Date.parse(e.occurred_at) - start) / 1000)}</span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}
