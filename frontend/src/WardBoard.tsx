import { useEffect, useState } from "react";

import { getWards, type Ward } from "./api";

const REFRESH_MS = 10_000;

/** Ward occupancy for every role, without patient data (UC-4). Refreshes itself. */
export default function WardBoard({ refreshKey = 0, compact = false }: { refreshKey?: number; compact?: boolean }) {
  const [wards, setWards] = useState<Ward[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      getWards()
        .then((data) => !cancelled && (setWards(data), setFailed(false)))
        .catch(() => !cancelled && setFailed(true));
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [refreshKey]);

  if (wards === null) {
    return <p className="card empty">{failed ? "Не удалось загрузить палаты" : "Загрузка…"}</p>;
  }

  const free = wards.reduce((sum, w) => sum + w.available, 0);
  const total = wards.reduce((sum, w) => sum + w.capacity, 0);
  const fullWards = wards.filter((w) => w.available === 0).length;
  const load = total ? Math.round(((total - free) / total) * 100) : 0;

  return (
    <div className="stack">
      {!compact && (
        <div className="stats">
          <Stat label="Всего мест" value={total} sub={`${wards.length} палат`} />
          <Stat label="Занято" value={total - free} sub={`загрузка ${load}%`} />
          <Stat label="Свободно" value={free} tone="ok" sub="можно госпитализировать" />
          <Stat
            label="Палат без мест"
            value={fullWards}
            tone={fullWards ? "down" : undefined}
            sub={fullWards ? "приём в них закрыт" : "везде есть места"}
          />
        </div>
      )}

      <section>
        <div className="section-head">
          <h2>Палаты</h2>
          <span className="hint">
            {compact && `свободно ${free} из ${total} мест · `}
            {failed ? "нет связи, данные могли устареть" : "обновляется автоматически"}
          </span>
        </div>
        <div className="ward-grid">
          {wards.map((ward) => (
            <WardCard key={ward.ward_id} ward={ward} />
          ))}
        </div>
      </section>
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: "ok" | "down" | "warn";
}) {
  return (
    <div className={`card stat${tone ? ` stat-${tone}` : ""}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

function WardCard({ ward }: { ward: Ward }) {
  const full = ward.available === 0;
  const share = ward.capacity ? ward.occupied / ward.capacity : 0;
  return (
    <article className={`card ward${full ? " ward-full" : ""}`}>
      <header>
        <div>
          <strong>{ward.ward_name}</strong>
          <span className="hint">
            № {ward.ward_id} · {ward.ward_type} · этаж {ward.floor}
          </span>
        </div>
        <span className={full ? "badge badge-down" : "badge badge-ok"}>{full ? "мест нет" : "есть места"}</span>
      </header>
      <div className="ward-figure">
        {ward.occupied}
        <small> / {ward.capacity} занято</small>
      </div>
      <div
        className={`meter${share >= 0.75 && !full ? " meter-busy" : ""}`}
        role="img"
        aria-label={`Занято ${ward.occupied} из ${ward.capacity}`}
      >
        <div className="meter-fill" style={{ width: `${share * 100}%` }} />
      </div>
      <p className="ward-numbers">
        <span>свободно {ward.available}</span>
        <span>{Math.round(share * 100)}%</span>
      </p>
    </article>
  );
}
