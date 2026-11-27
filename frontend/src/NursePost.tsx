import { Button, Card, Chip, Table, ToggleButton, ToggleButtonGroup } from "@heroui/react";
import { useEffect, useRef, useState, type Key } from "react";

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
import { Initials, Notice, ScreenSkeleton, StatCard } from "./ui";

// NFR-01: an alert must be on screen within 2 seconds
const POLL_MS = 1000;
const ESCALATE_AFTER_S = 30;

const PRIORITY_LABELS: Record<Priority, string> = { CRITICAL: "Критическое", HIGH: "Высокое", LOW: "Низкое" };
const STATUS_LABELS: Record<NurseStatus, string> = { Available: "Принимаю вызовы", Busy: "Занят(а)", OffShift: "Не на смене" };
const SOURCE_LABELS = { MONITOR: "монитор", CALL_BUTTON: "кнопка вызова" };

const PRIORITY_COLORS: Record<Priority, "danger" | "warning" | "default"> = {
  CRITICAL: "danger",
  HIGH: "warning",
  LOW: "default",
};

// Left stripe and tint of an alert card, by priority
const PRIORITY_CARD: Record<Priority, string> = {
  CRITICAL: "border-l-[var(--down)] bg-[var(--down-tint)]",
  HIGH: "border-l-[var(--warn)] bg-[var(--surface)]",
  LOW: "border-l-[var(--border-strong)] bg-[var(--surface)]",
};

const STATUS_SELECTED: Record<NurseStatus, string> = {
  Available: "data-[selected=true]:!bg-[var(--ok)] data-[selected=true]:!text-white",
  Busy: "data-[selected=true]:!bg-[var(--warn)] data-[selected=true]:!text-white",
  OffShift: "data-[selected=true]:!bg-[var(--muted)] data-[selected=true]:!text-white",
};

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
    <div className="flex flex-col gap-5">
      <Card>
        <Card.Content className="flex flex-row flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            {nurse && <Initials name={nurse.full_name} size="lg" />}
            <div className="flex min-w-0 flex-col gap-1.5">
              <strong className="text-lg text-[var(--text)]">{nurse?.full_name ?? "…"}</strong>
              <div className="flex flex-wrap gap-1.5">
                {headNurse ? (
                  <Chip size="sm" variant="soft" color="accent">
                    Все палаты отделения
                  </Chip>
                ) : nurse?.wards.length ? (
                  nurse.wards.map((w) => (
                    <Chip key={w.ward_id} size="sm" variant="soft" color={w.is_primary ? "accent" : "default"}>
                      {w.ward_name}
                      {w.is_primary ? " · основная" : ""}
                    </Chip>
                  ))
                ) : (
                  <span className="text-sm text-[var(--muted)]">Палаты не назначены</span>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <ToggleButtonGroup
              aria-label="Мой статус"
              selectionMode="single"
              disallowEmptySelection
              selectedKeys={nurse ? [nurse.status] : []}
              onSelectionChange={(keys: Set<Key>) => {
                const [next] = keys;
                if (next) void changeStatus(next as NurseStatus);
              }}
            >
              {(["Available", "Busy", "OffShift"] as NurseStatus[]).map((s) => (
                <ToggleButton
                  key={s}
                  id={s}
                  className={`bg-[var(--surface-2)] font-semibold text-[var(--text)] hover:bg-[var(--border)] ${STATUS_SELECTED[s]}`}
                >
                  {STATUS_LABELS[s]}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
            <ToggleButton isSelected={sound} onChange={toggleSound} className="gap-2 font-semibold">
              {sound ? <SoundOnIcon size={18} /> : <SoundOffIcon size={18} />}
              {sound ? "Звук включён" : "Звук выключен"}
            </ToggleButton>
          </div>
        </Card.Content>
      </Card>

      {error && <Notice kind="error">{error}</Notice>}
      {offline && <Notice kind="error">Нет связи с сервером, список может быть устаревшим</Notice>}

      {!board && !offline && <ScreenSkeleton stats={4} cards={2} />}

      {board && (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatCard label="Активные" value={board.open.length} sub={headNurse ? "по отделению" : "в ваших палатах"} />
          <StatCard
            label="Критические"
            value={critical}
            tone={critical ? "down" : undefined}
            sub={critical ? "требуют реакции сейчас" : "нет"}
          />
          <StatCard
            label="Эскалированы"
            value={escalated}
            tone={escalated ? "warn" : undefined}
            sub="не подтверждены за 30 с"
          />
          <StatCard label="Подтверждено за час" value={board.recent.length} tone="ok" sub={averageResponse(board.recent)} />
        </div>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="m-0 text-lg font-semibold text-[var(--text)]">Активные оповещения</h2>
          {board ? (
            <span className="flex items-center gap-2 text-xs text-[var(--muted)]">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
              </span>
              обновляется каждую секунду
            </span>
          ) : (
            <span className="text-xs text-[var(--muted)]">загрузка…</span>
          )}
        </div>
        {board && board.open.length === 0 && (
          <Card>
            <Card.Content className="flex flex-row items-center gap-3 py-6">
              <span className="flex size-10 items-center justify-center rounded-full bg-[var(--ok-bg)] text-lg font-bold text-[var(--ok)]">
                ✓
              </span>
              <span className="text-[var(--muted)]">Активных оповещений нет</span>
            </Card.Content>
          </Card>
        )}
        <div className="flex flex-col gap-3" aria-live="polite">
          {board?.open.map((alert) => (
            <AlertCard key={alert.alert_id} alert={alert} onAcknowledge={() => acknowledge(alert)} />
          ))}
        </div>
      </section>

      {board && board.recent.length > 0 && (
        <Card>
          <Card.Header>
            <Card.Title render={(props) => <h2 {...props} />}>Подтверждены за последний час</Card.Title>
          </Card.Header>
          <Card.Content>
            <Table>
              <Table.ScrollContainer>
                <Table.Content aria-label="Подтверждены за последний час">
                  <Table.Header>
                    <Table.Column isRowHeader>Оповещение</Table.Column>
                    <Table.Column>Палата</Table.Column>
                    <Table.Column>Приоритет</Table.Column>
                    <Table.Column>Подтвердил(а)</Table.Column>
                    <Table.Column>Время реакции</Table.Column>
                  </Table.Header>
                  <Table.Body>
                    {board.recent.map((a) => (
                      <Table.Row key={a.alert_id} id={a.alert_id}>
                        <Table.Cell>
                          <div className="flex flex-col">
                            <span className="font-medium">{a.alert_id}</span>
                            <span className="text-xs text-[var(--muted)]">{a.description}</span>
                          </div>
                        </Table.Cell>
                        <Table.Cell>{a.ward_name}</Table.Cell>
                        <Table.Cell>
                          <Chip size="sm" variant="soft" color={PRIORITY_COLORS[a.priority]}>
                            {PRIORITY_LABELS[a.priority]}
                          </Chip>
                        </Table.Cell>
                        <Table.Cell>
                          <div className="flex flex-col">
                            <span>{a.acknowledged_by_name}</span>
                            {a.escalated_to_id && <span className="text-xs text-[var(--muted)]">после эскалации</span>}
                          </div>
                        </Table.Cell>
                        <Table.Cell>
                          <span className="tabular-nums">{formatAge(responseSeconds(a))}</span>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Content>
              </Table.ScrollContainer>
            </Table>
          </Card.Content>
        </Card>
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
    <article
      className={`flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-l-[6px] border-[var(--border)] p-4 shadow-sm ${
        PRIORITY_CARD[alert.priority]
      } ${alert.mine ? "" : "opacity-70"}`}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Chip size="sm" variant="primary" color={PRIORITY_COLORS[alert.priority]} className="font-bold uppercase">
            {PRIORITY_LABELS[alert.priority]}
          </Chip>
          <strong className="text-base text-[var(--text)]">{alert.description ?? "Оповещение"}</strong>
          {alert.status === "ESCALATED" && (
            <Chip size="sm" variant="soft" color="warning">
              Эскалировано
            </Chip>
          )}
        </div>
        <p className="m-0 text-sm text-[var(--muted)]">
          {alert.ward_name}
          {alert.patient_name && ` · ${alert.patient_name}`} · {SOURCE_LABELS[alert.source]} · {alert.alert_id}
        </p>
        <p className="m-0 text-sm text-[var(--muted)]">
          Назначено: {alert.assigned_nurse_name ?? "никому (нет медсестры на смене)"}
          {alert.status === "ESCALATED" && (
            <span className="font-medium text-[var(--down)]"> · эскалировано: {alert.escalated_to_name}</span>
          )}
          {escalates &&
            (left > 0 ? (
              <span>
                {" "}
                · {next} через {left} с
              </span>
            ) : left > -3 ? (
              // The escalation round runs every ~2 s
              <span> · передаётся дальше…</span>
            ) : (
              // Every nurse on shift was already called (decisions.md, record 12)
              <span className="font-medium text-[var(--down)]"> · все медсёстры на смене уже вызваны, ждёт ответа</span>
            ))}
        </p>
      </div>
      <div className="flex items-center gap-4">
        <span className="text-xl font-bold tabular-nums text-[var(--text)]" title="Сколько прошло с момента оповещения">
          {formatAge(alert.age_seconds)}
        </span>
        {alert.can_acknowledge && (
          <Button
            isDisabled={busy}
            onPress={async () => {
              setBusy(true);
              await onAcknowledge();
              setBusy(false);
            }}
          >
            Подтвердить
          </Button>
        )}
      </div>
    </article>
  );
}
