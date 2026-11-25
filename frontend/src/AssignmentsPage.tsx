import { useCallback, useEffect, useState } from "react";

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

type Notice = { kind: "ok" | "error"; text: string } | null;

type Cell = "none" | "additional" | "primary";

const STATUS_LABELS: Record<NurseStatus, string> = {
  Available: "Свободна",
  Busy: "Занята",
  OffShift: "Не на смене",
};

const STATUS_BADGE: Record<NurseStatus, string> = {
  Available: "badge badge-ok",
  Busy: "badge badge-warn",
  OffShift: "badge badge-muted",
};

const ACTION_LABELS: Record<AssignmentAction, string> = {
  ASSIGN_PRIMARY: "Новая основная",
  ASSIGN_ADDITIONAL: "Добавлена дополнительная",
  REMOVE_ADDITIONAL: "Снята дополнительная",
  AUTO_ASSIGN_PRIMARY: "Автоназначение основной",
};

const TIME = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

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
  const [notice, setNotice] = useState<Notice>(null);
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
    return notice ? <p className="notice notice-error" role="alert">{notice.text}</p> : <div className="card" aria-busy="true" />;
  }

  return (
    <div className="stack">
      {notice && (
        <p className={`notice notice-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>
          {notice.text}
        </p>
      )}

      <section className="card">
        <div className="section-head">
          <h2>Медсёстры и палаты</h2>
          <span className="badge badge-muted">{board.wards.length} палат</span>
        </div>
        <p className="hint">
          В каждой палате ровно одна основная медсестра: она получает оповещения палаты первой. Снять основную
          нельзя — назначьте вместо неё другую, и прежняя останется дополнительной.
        </p>
        <label className="assign-reason">
          Причина изменения (необязательно, попадёт в журнал)
          <input
            value={reason}
            maxLength={200}
            placeholder="например, пересменка"
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <div className="table-wrap">
          <table className="table assign-table">
            <thead>
              <tr>
                <th>Медсестра</th>
                {board.wards.map((w) => (
                  <th key={w.ward_id}>
                    {w.ward_name}
                    <span className="hint block">№ {w.ward_id}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {board.nurses.map((nurse) => (
                <tr key={nurse.nurse_id}>
                  <td>
                    <strong>{nurse.full_name}</strong>
                    <span className="hint block">
                      {nurse.nurse_id}
                      {nurse.role === "HeadNurse" ? " · старшая" : ""}
                    </span>
                    <span className={STATUS_BADGE[nurse.status]}>{STATUS_LABELS[nurse.status]}</span>
                  </td>
                  {board.wards.map((ward) => (
                    <td key={ward.ward_id}>
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
      </section>

      <AssignmentLog entries={log} wards={board.wards} ward={logWard} onWard={setLogWard} />
    </div>
  );
}

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

  const options: { value: Cell; label: string; className: string }[] = [
    { value: "none", label: "—", className: "" },
    { value: "additional", label: "Доп.", className: "assign-additional" },
    { value: "primary", label: "Осн.", className: "segment-accent" },
  ];

  return (
    <div
      className="segmented assign-cell"
      role="radiogroup"
      aria-label={`${nurse.full_name}, ${ward.ward_name}`}
      aria-busy={saving}
    >
      {options.map((o) => {
        const reason = blocked(o.value);
        const active = o.value === current;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            className={active ? `segment segment-active ${o.className}` : "segment"}
            disabled={busy || reason !== null}
            title={reason ?? undefined}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        );
      })}
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
    <section className="card">
      <div className="section-head">
        <h2>Журнал назначений</h2>
        <select
          aria-label="Палата в журнале"
          value={ward ?? ""}
          onChange={(e) => onWard(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">все палаты</option>
          {wards.map((w) => (
            <option key={w.ward_id} value={w.ward_id}>
              {w.ward_name}
            </option>
          ))}
        </select>
      </div>
      {entries.length === 0 ? (
        <p className="empty">Изменений пока не было</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Когда</th>
                <th>Палата</th>
                <th>Что</th>
                <th>Медсестра</th>
                <th>Кто изменил</th>
                <th>Причина</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.log_id}>
                  <td className="num">{TIME.format(new Date(e.changed_at))}</td>
                  <td>{e.ward_name}</td>
                  <td>
                    {ACTION_LABELS[e.action]}
                    {e.previous_primary_nurse_id && e.action.endsWith("PRIMARY") && (
                      <span className="hint block">вместо {e.previous_primary_nurse_id}</span>
                    )}
                  </td>
                  <td>{e.nurse_name}</td>
                  <td>{e.changed_by_name ?? "автоматически"}</td>
                  <td>{e.reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
