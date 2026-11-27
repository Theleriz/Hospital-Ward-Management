import { Card, Chip } from "@heroui/react";
import { useEffect, useState } from "react";

import { getWards, type Ward } from "./api";
import { ScreenSkeleton, StatCard } from "./ui";

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
    return failed ? (
      <Card>
        <Card.Content className="py-8 text-center text-[var(--muted)]">Не удалось загрузить палаты</Card.Content>
      </Card>
    ) : (
      <ScreenSkeleton stats={compact ? 0 : 4} cards={1} />
    );
  }

  const free = wards.reduce((sum, w) => sum + w.available, 0);
  const total = wards.reduce((sum, w) => sum + w.capacity, 0);
  const fullWards = wards.filter((w) => w.available === 0).length;
  const load = total ? Math.round(((total - free) / total) * 100) : 0;

  return (
    <div className="flex flex-col gap-5">
      {!compact && (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatCard label="Всего мест" value={total} sub={`${wards.length} палат`} />
          <StatCard label="Занято" value={total - free} sub={`загрузка ${load}%`} />
          <StatCard label="Свободно" value={free} tone="ok" sub="можно госпитализировать" />
          <StatCard
            label="Палат без мест"
            value={fullWards}
            tone={fullWards ? "down" : undefined}
            sub={fullWards ? "приём в них закрыт" : "везде есть места"}
          />
        </div>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="m-0 text-lg font-semibold text-[var(--text)]">Палаты</h2>
          <span className="text-xs text-[var(--muted)]">
            {compact && `свободно ${free} из ${total} мест · `}
            {failed ? "нет связи, данные могли устареть" : "обновляется автоматически"}
          </span>
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
          {wards.map((ward) => (
            <WardCard key={ward.ward_id} ward={ward} />
          ))}
        </div>
      </section>
    </div>
  );
}

function WardCard({ ward }: { ward: Ward }) {
  const full = ward.available === 0;
  const share = ward.capacity ? ward.occupied / ward.capacity : 0;
  const busy = share >= 0.75 && !full;
  const bar = full ? "bg-[var(--down)]" : busy ? "bg-[var(--warn)]" : "bg-[var(--ok)]";
  return (
    <article
      className={`flex flex-col gap-3 rounded-2xl border bg-[var(--surface)] p-4 shadow-sm ${
        full ? "border-[var(--down)]/40" : "border-[var(--border)]"
      }`}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <strong className="truncate text-[var(--text)]">{ward.ward_name}</strong>
          <span className="text-xs text-[var(--muted)]">
            № {ward.ward_id} · {ward.ward_type} · этаж {ward.floor}
          </span>
        </div>
        <Chip size="sm" variant="soft" color={full ? "danger" : "success"} className="shrink-0">
          {full ? "мест нет" : "есть места"}
        </Chip>
      </header>
      <div className="flex items-baseline gap-1.5">
        <span className="text-4xl font-bold tabular-nums text-[var(--text)]">{ward.occupied}</span>
        <span className="text-sm text-[var(--muted)]">/ {ward.capacity} занято</span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-[var(--border)]"
        role="img"
        aria-label={`Занято ${ward.occupied} из ${ward.capacity}`}
      >
        <div className={`h-full rounded-full transition-all ${bar}`} style={{ width: `${share * 100}%` }} />
      </div>
      <p className="m-0 flex justify-between text-xs text-[var(--muted)]">
        <span>свободно {ward.available}</span>
        <span className="tabular-nums">{Math.round(share * 100)}%</span>
      </p>
    </article>
  );
}
