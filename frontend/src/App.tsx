import { useEffect, useState } from "react";

import AdmissionsPage from "./AdmissionsPage";
import {
  getCurrentUser,
  getHealth,
  logout,
  ROLE_LABELS,
  UNAUTHORIZED_EVENT,
  type Health,
  type Role,
  type User,
} from "./api";
import LoginScreen from "./LoginScreen";
import WardBoard from "./WardBoard";

type Session = { kind: "checking" } | { kind: "anonymous" } | { kind: "signed-in"; user: User };

type Page = "admissions" | "wards";

const PAGE_LABELS: Record<Page, string> = {
  admissions: "Приёмное отделение",
  wards: "Палаты",
};

// Screens each role can open; the first one opens after login
const PAGES: Record<Role, Page[]> = {
  Admissions: ["admissions", "wards"],
  PublicStaff: ["wards"],
  Nurse: ["wards"],
  HeadNurse: ["wards"],
};

export default function App() {
  const [session, setSession] = useState<Session>({ kind: "checking" });

  useEffect(() => {
    getCurrentUser()
      .then((user) => setSession(user ? { kind: "signed-in", user } : { kind: "anonymous" }))
      .catch(() => setSession({ kind: "anonymous" }));

    const onUnauthorized = () => setSession({ kind: "anonymous" });
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
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
        {session.kind === "signed-in" && <Workspace key={session.user.account_id} user={session.user} />}
      </main>

      <SystemStatus />
    </div>
  );
}

function Workspace({ user }: { user: User }) {
  const pages = PAGES[user.role];
  const [page, setPage] = useState<Page>(pages[0]);

  return (
    <>
      {pages.length > 1 && (
        <nav className="tabs" aria-label="Разделы">
          {pages.map((p) => (
            <button
              key={p}
              type="button"
              className={p === page ? "tab tab-active" : "tab"}
              aria-current={p === page ? "page" : undefined}
              onClick={() => setPage(p)}
            >
              {PAGE_LABELS[p]}
            </button>
          ))}
        </nav>
      )}
      {page === "admissions" && <AdmissionsPage />}
      {page === "wards" && <WardBoard />}
    </>
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

  const backend = state.kind === "loaded";
  const database = state.kind === "loaded" && state.health.database === "ok";
  const word = (ok: boolean) => (state.kind === "loading" ? "проверка…" : ok ? "работает" : "недоступна");

  return (
    <footer className="footer" aria-live="polite">
      <span className={`dot ${backend ? "dot-ok" : "dot-down"}`} /> Backend: {word(backend)}
      <span className={`dot ${database ? "dot-ok" : "dot-down"}`} /> База данных: {word(database)}
    </footer>
  );
}
