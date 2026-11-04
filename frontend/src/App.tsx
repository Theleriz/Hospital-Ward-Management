import { useEffect, useState } from "react";

import { getHealth, type Health } from "./api";

type State = { kind: "loading" } | { kind: "loaded"; health: Health } | { kind: "failed" };

export default function App() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    getHealth()
      .then((health) => setState({ kind: "loaded", health }))
      .catch(() => setState({ kind: "failed" }));
  }, []);

  return (
    <main className="page">
      <h1>Hospital Ward Management</h1>
      <p className="subtitle">Team MedBase</p>

      <section className="status" aria-live="polite">
        <h2>Состояние системы</h2>
        <StatusRow label="Backend" ok={state.kind === "loaded"} loading={state.kind === "loading"} />
        <StatusRow
          label="База данных"
          ok={state.kind === "loaded" && state.health.database === "ok"}
          loading={state.kind === "loading"}
        />
      </section>
    </main>
  );
}

function StatusRow({ label, ok, loading }: { label: string; ok: boolean; loading: boolean }) {
  const text = loading ? "проверка…" : ok ? "работает" : "недоступна";
  const modifier = loading ? "loading" : ok ? "ok" : "down";
  return (
    <p className="status-row">
      <span>{label}</span>
      <span className={`badge badge-${modifier}`}>{text}</span>
    </p>
  );
}
