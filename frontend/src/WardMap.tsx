import { useEffect, useState } from "react";

import { getWardMap, type MapNurse, type MapWard, type NurseStatus, type WardMapData } from "./api";

// Same pace as the nurse post: the map shows each escalation as it happens
const REFRESH_MS = 1_000;

const STATUS_LABELS: Record<NurseStatus, string> = {
  Available: "свободна",
  Busy: "занята",
  OffShift: "не на смене",
};

const PRIORITY_LABELS = { CRITICAL: "Критический", HIGH: "Высокий", LOW: "Низкий" } as const;

/**
 * Ward map (decisions.md, record 14): floors and wards, where each nurse is right now
 * (last door badge reader), her or his status and the open alerts of each ward.
 * Shows whom the escalation calls and why: the nearest free nurse first.
 */
export default function WardMap() {
  const [data, setData] = useState<WardMapData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      getWardMap()
        .then((d) => !cancelled && (setData(d), setFailed(false)))
        .catch(() => !cancelled && setFailed(true));
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  if (data === null) {
    return <p className="card empty">{failed ? "Не удалось загрузить карту" : "Загрузка…"}</p>;
  }

  return (
    <div className="stack">
      <div className="map-legend hint">
        <span><i className="dot-status dot-Available" /> свободна</span>
        <span><i className="dot-status dot-Busy" /> занята</span>
        <span><i className="dot-status dot-OffShift" /> не на смене</span>
        <span><i className="dot-status dot-alert" /> вызов в палате</span>
        <span>
          Где медсестра — по последнему считывателю бейджа у двери палаты (действует{" "}
          {data.location_fresh_minutes} мин)
        </span>
      </div>

      {data.floors.map((floor) => (
        <section key={floor.floor} className="card">
          <h2>Этаж {floor.floor}</h2>
          <div className="map-wards">
            {floor.wards.map((ward) => (
              <WardTile key={ward.ward_id} ward={ward} />
            ))}
          </div>
        </section>
      ))}

      <section className="card map-others">
        <div>
          <h2>Местоположение неизвестно</h2>
          <NurseList nurses={data.location_unknown} empty="все медсёстры на смене отмечены" />
        </div>
        <div>
          <h2>Не на смене</h2>
          <NurseList nurses={data.off_shift} empty="никого" />
        </div>
      </section>
    </div>
  );
}

function WardTile({ ward }: { ward: MapWard }) {
  const alarm = ward.alerts.some((a) => a.priority !== "LOW");
  return (
    <article className={`map-ward${alarm ? " map-ward-alarm" : ""}`} aria-label={ward.ward_name}>
      <header className="map-ward-head">
        <strong>
          {ward.ward_id} · {ward.ward_name}
        </strong>
        <span className="hint">
          {ward.ward_type} · коек {ward.occupied}/{ward.capacity}
        </span>
      </header>

      {ward.alerts.map((a) => (
        <p key={a.alert_id} className="map-alert">
          <span className={`priority priority-${a.priority}`}>{PRIORITY_LABELS[a.priority]}</span>{" "}
          {a.alert_id} · {a.age_seconds} с
          <span className="block hint">
            {a.status === "ESCALATED"
              ? `вызвана: ${a.escalated_to_name}`
              : `ждёт: ${a.assigned_nurse_name ?? "никому не назначено"}`}
          </span>
        </p>
      ))}

      <NurseList nurses={ward.nurses_here} empty="медсестёр нет" />
    </article>
  );
}

function NurseList({ nurses, empty }: { nurses: MapNurse[]; empty: string }) {
  if (nurses.length === 0) {
    return <p className="hint">{empty}</p>;
  }
  return (
    <ul className="map-nurses">
      {nurses.map((n) => (
        <li key={n.nurse_id} className="map-nurse" title={`${n.nurse_id} · ${STATUS_LABELS[n.status]}`}>
          <i className={`dot-status dot-${n.status}`} />
          <span>
            {n.full_name}
            {n.role === "HeadNurse" && <span className="hint"> (старшая)</span>}
          </span>
          <span className="hint">
            {STATUS_LABELS[n.status]}
            {n.open_calls > 0 && ` · на вызове: ${n.open_calls}`}
          </span>
        </li>
      ))}
    </ul>
  );
}
