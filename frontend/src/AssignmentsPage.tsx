import { Card, Chip, Input, Label, ListBox, Select, Table, TextField, ToggleButton, ToggleButtonGroup } from "@heroui/react";
import { useCallback, useEffect, useState, type Key } from "react";

import {
  addWardNurse,
  ApiError,
  getAssignmentLog,
  getAssignments,
  removeWardNurse,
  setPrimaryNurse,
  type AssignmentAction,
  type AssignmentBoard,
  type AssignmentLogEntry,
  type NurseOption,
  type NurseStatus,
  type WardAssignment,
} from "./api";
import { initials, Notice, ScreenSkeleton, StatCard } from "./ui";

// "Назначения" is the first screen built with HeroUI (src/heroui.css); the other
// screens still use index.css. Labels and roles are the same as before, so the
// unit and end-to-end tests read the screen the same way.

type NoticeState = { kind: "ok" | "error"; text: string } | null;

type Cell = "none" | "additional" | "primary";

const STATUS: Record<NurseStatus, { label: string; color: "success" | "warning" | "default" }> = {
  Available: { label: "Свободна", color: "success" },
  Busy: { label: "Занята", color: "warning" },
  OffShift: { label: "Не на смене", color: "default" },
};

const ACTION_LABELS: Record<AssignmentAction, string> = {
  ASSIGN_PRIMARY: "Новая основная",
  ASSIGN_ADDITIONAL: "Добавлена дополнительная",
  REMOVE_ADDITIONAL: "Снята дополнительная",
  AUTO_ASSIGN_PRIMARY: "Автоназначение основной",
};

const ACTION_COLORS: Record<AssignmentAction, "accent" | "success" | "danger" | "warning"> = {
  ASSIGN_PRIMARY: "accent",
  ASSIGN_ADDITIONAL: "success",
  REMOVE_ADDITIONAL: "danger",
  AUTO_ASSIGN_PRIMARY: "warning",
};

const TIME = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const ALL_WARDS = "all";

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : "Сервер недоступен";
}

function cellOf(ward: WardAssignment, nurseId: string): Cell {
  const nurse = ward.nurses.find((n) => n.nurse_id === nurseId);
  if (!nurse) return "none";
  return nurse.is_primary ? "primary" : "additional";
}


/** Head nurse: who works in which ward, primary and additional nurses (T-51). */
export default function AssignmentsPage() {
  const [board, setBoard] = useState<AssignmentBoard | null>(null);
  const [log, setLog] = useState<AssignmentLogEntry[]>([]);
  const [logWard, setLogWard] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<NoticeState>(null);
  // Cell being saved, as "ward:nurse"; the whole table waits for one change at a time
  const [saving, setSaving] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [assignments, entries] = await Promise.all([getAssignments(), getAssignmentLog(logWard)]);
      setBoard(assignments);
      setLog(entries);
    } catch (error) {
      setNotice({ kind: "error", text: messageOf(error) });
    }
  }, [logWard]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function change(ward: WardAssignment, nurse: NurseOption, to: Cell) {
    const from = cellOf(ward, nurse.nurse_id);
    if (from === to) return;
    const why = reason.trim() || null;
    setSaving(`${ward.ward_id}:${nurse.nurse_id}`);
    try {
      if (to === "primary") {
        await setPrimaryNurse(ward.ward_id, nurse.nurse_id, why);
        const previous = ward.nurses.find((n) => n.is_primary);
        setNotice({
          kind: "ok",
          text:
            `${nurse.full_name} — основная медсестра палаты «${ward.ward_name}». ` +
            (previous ? `${previous.full_name} осталась дополнительной. ` : "") +
            "Новые оповещения палаты пойдут ей, уже созданные остаются у прежних медсестёр.",
        });
      } else if (to === "additional") {
        await addWardNurse(ward.ward_id, nurse.nurse_id, why);
        setNotice({ kind: "ok", text: `${nurse.full_name} добавлена в палату «${ward.ward_name}» дополнительной` });
      } else {
        await removeWardNurse(ward.ward_id, nurse.nurse_id, why);
        setNotice({ kind: "ok", text: `${nurse.full_name} снята с палаты «${ward.ward_name}»` });
      }
      setReason("");
    } catch (error) {
      setNotice({ kind: "error", text: messageOf(error) });
    } finally {
      setSaving(null);
      await reload();
    }
  }

  if (!board) {
    return notice ? (
      <Notice kind={notice.kind}>{notice.text}</Notice>
    ) : (
      <ScreenSkeleton stats={3} cards={2} />
    );
  }

  const assigned = board.wards.reduce((n, w) => n + w.nurses.length, 0);

  return (
    <div className="flex flex-col gap-5">
      {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Палат" value={board.wards.length} />
        <StatCard label="Медсестёр" value={board.nurses.length} />
        <StatCard label="Назначений" value={assigned} />
      </div>

      <Card>
        <Card.Header className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <Card.Title render={(props) => <h2 {...props} />}>Медсёстры и палаты</Card.Title>
            <Card.Description>
              В каждой палате ровно одна основная медсестра: она получает оповещения палаты первой. Снять основную
              нельзя — назначьте вместо неё другую, и прежняя останется дополнительной.
            </Card.Description>
          </div>
          <Chip variant="soft">{board.wards.length} палат</Chip>
        </Card.Header>

        <Card.Content className="flex flex-col gap-4">
          <TextField className="max-w-md" value={reason} onChange={setReason} maxLength={200}>
            <Label>Причина изменения (необязательно, попадёт в журнал)</Label>
            <Input placeholder="например, пересменка" />
          </TextField>

          <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-[var(--surface-2)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                  <th className="min-w-56 px-4 py-3 font-semibold">Медсестра</th>
                  {board.wards.map((w) => (
                    <th key={w.ward_id} className="px-3 py-3 font-semibold">
                      {w.ward_name}
                      <span className="block font-normal normal-case">№ {w.ward_id}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {board.nurses.map((nurse) => (
                  <tr key={nurse.nurse_id} className="border-t border-[var(--border)] hover:bg-[var(--surface-2)]">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span
                          aria-hidden="true"
                          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--accent-bg)] text-xs font-bold text-[var(--accent)]"
                        >
                          {initials(nurse.full_name)}
                        </span>
                        <div className="flex flex-col gap-1">
                          <strong className="whitespace-nowrap text-[var(--text)]">{nurse.full_name}</strong>
                          <span className="text-xs text-[var(--muted)]">
                            {nurse.nurse_id}
                            {nurse.role === "HeadNurse" ? " · старшая" : ""}
                          </span>
                          <Chip size="sm" variant="soft" color={STATUS[nurse.status].color} className="w-fit">
                            {STATUS[nurse.status].label}
                          </Chip>
                        </div>
                      </div>
                    </td>
                    {board.wards.map((ward) => (
                      <td key={ward.ward_id} className="px-3 py-3">
                        <AssignmentCell
                          ward={ward}
                          nurse={nurse}
                          busy={saving !== null}
                          saving={saving === `${ward.ward_id}:${nurse.nurse_id}`}
                          onChange={(to) => change(ward, nurse, to)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Legend />
        </Card.Content>
      </Card>

      <AssignmentLog entries={log} wards={board.wards} ward={logWard} onWard={setLogWard} />
    </div>
  );
}



function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--muted)]">
      <span className="flex items-center gap-2">
        <span className="rounded-md bg-[var(--accent)] px-2 py-0.5 font-semibold text-white">Осн.</span>
        основная: оповещения палаты идут ей первой
      </span>
      <span className="flex items-center gap-2">
        <span className="rounded-md bg-[var(--accent-bg)] px-2 py-0.5 font-semibold text-[var(--accent)]">Доп.</span>
        дополнительная: видит оповещения палаты
      </span>
      <span className="flex items-center gap-2">
        <span className="rounded-md border border-[var(--border)] px-2 py-0.5">—</span>
        не работает в палате
      </span>
    </div>
  );
}

const OPTIONS: { value: Cell; label: string; selected: string }[] = [
  {
    value: "none",
    label: "—",
    selected: "data-[selected=true]:!bg-[var(--border-strong)] data-[selected=true]:!text-[var(--text)]",
  },
  {
    value: "additional",
    label: "Доп.",
    selected: "data-[selected=true]:!bg-[var(--accent-bg)] data-[selected=true]:!text-[var(--accent)]",
  },
  {
    value: "primary",
    label: "Осн.",
    selected: "data-[selected=true]:!bg-[var(--accent)] data-[selected=true]:!text-white",
  },
];

function AssignmentCell({
  ward,
  nurse,
  busy,
  saving,
  onChange,
}: {
  ward: WardAssignment;
  nurse: NurseOption;
  busy: boolean;
  saving: boolean;
  onChange: (to: Cell) => void;
}) {
  const current = cellOf(ward, nurse.nurse_id);
  const offShift = nurse.status === "OffShift";

  // Why an option cannot be chosen, or null when it can
  const blocked = (option: Cell): string | null => {
    if (option === current) return null;
    if (current === "primary") return "Основную нельзя снять: назначьте другую основную";
    if (offShift && option !== "none") return "Медсестра не на смене";
    return null;
  };

  return (
    // aria-busy on a wrapper: ToggleButtonGroup passes only its own props to the DOM
    <div aria-busy={saving}>
      <ToggleButtonGroup
        aria-label={`${nurse.full_name}, ${ward.ward_name}`}
        selectionMode="single"
        disallowEmptySelection
        size="sm"
        selectedKeys={[current]}
        onSelectionChange={(keys: Set<Key>) => {
          const [next] = keys;
          if (next) onChange(next as Cell);
        }}
        isDisabled={busy}
        className={saving ? "animate-pulse" : undefined}
      >
        {OPTIONS.map((o) => {
          const reason = blocked(o.value);
          return (
            <ToggleButton
              key={o.value}
              id={o.value}
              isDisabled={reason !== null}
              className={`min-w-11 font-semibold ${o.selected}`}
            >
              {/* The title lives on the label: a disabled button gets no pointer events */}
              <span title={reason ?? undefined}>{o.label}</span>
            </ToggleButton>
          );
        })}
      </ToggleButtonGroup>
    </div>
  );
}

function AssignmentLog({
  entries,
  wards,
  ward,
  onWard,
}: {
  entries: AssignmentLogEntry[];
  wards: WardAssignment[];
  ward: number | null;
  onWard: (ward: number | null) => void;
}) {
  return (
    <Card>
      <Card.Header className="flex flex-row flex-wrap items-center justify-between gap-3">
        <Card.Title render={(props) => <h2 {...props} />}>Журнал назначений</Card.Title>
        <Select
          aria-label="Палата в журнале"
          className="w-60"
          selectedKey={ward === null ? ALL_WARDS : String(ward)}
          onSelectionChange={(key) => onWard(key === ALL_WARDS || key === null ? null : Number(key))}
        >
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              <ListBox.Item id={ALL_WARDS} textValue="все палаты">
                все палаты
              </ListBox.Item>
              {wards.map((w) => (
                <ListBox.Item key={w.ward_id} id={String(w.ward_id)} textValue={w.ward_name}>
                  {w.ward_name}
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      </Card.Header>
      <Card.Content>
        <Table>
          <Table.ScrollContainer>
            <Table.Content aria-label="Журнал назначений">
              <Table.Header>
                <Table.Column isRowHeader>Когда</Table.Column>
                <Table.Column>Палата</Table.Column>
                <Table.Column>Что</Table.Column>
                <Table.Column>Медсестра</Table.Column>
                <Table.Column>Кто изменил</Table.Column>
                <Table.Column>Причина</Table.Column>
              </Table.Header>
              <Table.Body
                renderEmptyState={() => (
                  <p className="py-6 text-center text-sm text-[var(--muted)]">Изменений пока не было</p>
                )}
              >
                {entries.map((e) => (
                  <Table.Row key={e.log_id} id={e.log_id}>
                    <Table.Cell>
                      <span className="tabular-nums">{TIME.format(new Date(e.changed_at))}</span>
                    </Table.Cell>
                    <Table.Cell>{e.ward_name}</Table.Cell>
                    <Table.Cell>
                      <div className="flex flex-col gap-1">
                        <Chip size="sm" variant="soft" color={ACTION_COLORS[e.action]} className="w-fit">
                          {ACTION_LABELS[e.action]}
                        </Chip>
                        {e.previous_primary_nurse_id && e.action.endsWith("PRIMARY") && (
                          <span className="text-xs text-[var(--muted)]">вместо {e.previous_primary_nurse_id}</span>
                        )}
                      </div>
                    </Table.Cell>
                    <Table.Cell>{e.nurse_name}</Table.Cell>
                    <Table.Cell>{e.changed_by_name ?? "автоматически"}</Table.Cell>
                    <Table.Cell>{e.reason ?? "—"}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      </Card.Content>
    </Card>
  );
}
