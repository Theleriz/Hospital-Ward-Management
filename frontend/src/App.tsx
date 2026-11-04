import { useEffect, useState } from "react";

import { getCurrentUser, getHealth, logout, ROLE_LABELS, type Health, type User } from "./api";
import LoginScreen from "./LoginScreen";

type Session = { kind: "checking" } | { kind: "anonymous" } | { kind: "signed-in"; user: User };

export default function App() {
  const [session, setSession] = useState<Session>({ kind: "checking" });

  useEffect(() => {
    getCurrentUser()
      .then((user) => setSession(user ? { kind: "signed-in", user } : { kind: "anonymous" }))
      .catch(() => setSession({ kind: "anonymous" }));
  }, []);

  async function onLogout() {
    await logout().catch(() => undefined);
    setSession({ kind: "anonymous" });
  }

  return (
    <div className="page">
      <header className="header">
        <div>
          <h1>Hospital Ward Management</h1>
          <p className="subtitle">Team MedBase</p>
        </div>
        {session.kind === "signed-in" && (
          <div className="user">
            <span>
              {session.user.full_name}
              <span className="role">{ROLE_LABELS[session.user.role]}</span>
            </span>
            <button type="button" className="secondary" onClick={onLogout}>
              Выйти
            </button>
          </div>
        )}
      </header>

      <main>
        {session.kind === "anonymous" && (
          <LoginScreen onLogin={(user) => setSession({ kind: "signed-in", user })} />
        )}
        {session.kind === "signed-in" && <SystemStatus />}
      </main>
    </div>
  );
}

type HealthState = { kind: "loading" } | { kind: "loaded"; health: Health } | { kind: "failed" };

function SystemStatus() {
  const [state, setState] = useState<HealthState>({ kind: "loading" });

  useEffect(() => {
    getHealth()
      .then((health) => setState({ kind: "loaded", health }))
      .catch(() => setState({ kind: "failed" }));
  }, []);

  return (
    <section className="card" aria-live="polite">
      <h2>Состояние системы</h2>
      <StatusRow label="Backend" ok={state.kind === "loaded"} loading={state.kind === "loading"} />
      <StatusRow
        label="База данных"
        ok={state.kind === "loaded" && state.health.database === "ok"}
        loading={state.kind === "loading"}
      />
    </section>
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
