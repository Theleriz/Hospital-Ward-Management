import { useEffect, useState } from "react";

import { getWards, type Ward } from "./api";

const REFRESH_MS = 10_000;

/** Ward occupancy for every role, without patient data (UC-4). Refreshes itself. */
export default function WardBoard({ refreshKey = 0 }: { refreshKey?: number }) {
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
    return <p className="hint">{failed ? "Не удалось загрузить палаты" : "Загрузка…"}</p>;
  }

  const free = wards.reduce((sum, w) => sum + w.available, 0);
  const total = wards.reduce((sum, w) => sum + w.capacity, 0);

  return (
    <section>
      <div className="section-head">
        <h2>Палаты</h2>
        <span className="hint">
          свободно {free} из {total} мест{failed && " · данные могли устареть"}
        </span>
      </div>
      <div className="ward-grid">
        {wards.map((ward) => (
          <WardCard key={ward.ward_id} ward={ward} />
        ))}
      </div>
    </section>
  );
}

function WardCard({ ward }: { ward: Ward }) {
  const full = ward.available === 0;
  const share = ward.capacity ? ward.occupied / ward.capacity : 0;
  return (
    <article className={`card ward${full ? " ward-full" : ""}`}>
      <header>
        <strong>{ward.ward_name}</strong>
        <span className="hint">
          № {ward.ward_id} · {ward.ward_type} · этаж {ward.floor}
        </span>
      </header>
      <div className="meter" role="img" aria-label={`Занято ${ward.occupied} из ${ward.capacity}`}>
        <div className="meter-fill" style={{ width: `${share * 100}%` }} />
      </div>
      <p className="ward-numbers">
        <span>
          занято {ward.occupied} из {ward.capacity}
        </span>
        <span className={full ? "badge badge-down" : "badge badge-ok"}>
          {full ? "мест нет" : `свободно ${ward.available}`}
        </span>
      </p>
    </article>
  );
}
