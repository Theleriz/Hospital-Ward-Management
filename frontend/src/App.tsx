import { useEffect, useState, type ComponentType } from "react";

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
import {
  AdmissionsIcon,
  LogoMark,
  LogoutIcon,
  MoonIcon,
  PostIcon,
  ReportIcon,
  SimulatorIcon,
  SunIcon,
  WardsIcon,
} from "./icons";
import LoginScreen from "./LoginScreen";
import NursePost from "./NursePost";
import ReportPage from "./ReportPage";
import SimulatorPage from "./SimulatorPage";
import { useTheme } from "./theme";
import WardBoard from "./WardBoard";

type Session = { kind: "checking" } | { kind: "anonymous" } | { kind: "signed-in"; user: User };

type Page = "admissions" | "post" | "report" | "wards" | "simulator";

type PageInfo = {
  label: string;
  icon: ComponentType<{ size?: number }>;
  description: (role: Role) => string;
};

const PAGE_INFO: Record<Page, PageInfo> = {
  admissions: {
    label: "Приёмное отделение",
    icon: AdmissionsIcon,
    description: () => "Регистрация, госпитализация, перевод и выписка пациентов",
  },
  post: {
    label: "Пост медсестры",
    icon: PostIcon,
    description: (role) =>
      role === "HeadNurse"
        ? "Все оповещения отделения в реальном времени"
        : "Оповещения ваших палат в реальном времени",
  },
  report: {
    label: "Отчёт старшей медсестры",
    icon: ReportIcon,
    description: () => "Время реакции, эскалации и история оповещений отделения",
  },
  wards: {
    label: "Палаты",
    icon: WardsIcon,
    description: () => "Занятость коечного фонда, без данных пациентов",
  },
  simulator: {
    label: "Симулятор устройств",
    icon: SimulatorIcon,
    description: () => "Демонстрационная замена мониторов пациента и кнопок вызова",
  },
};

// Screens each role can open; the first one opens after login
const PAGES: Record<Role, Page[]> = {
  Admissions: ["admissions", "wards"],
  PublicStaff: ["wards"],
  Nurse: ["post", "wards", "simulator"],
  HeadNurse: ["report", "post", "wards", "simulator"],
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

  if (session.kind === "checking") {
    return <div className="splash" aria-busy="true" />;
  }
  if (session.kind === "anonymous") {
    return <LoginScreen onLogin={(user) => setSession({ kind: "signed-in", user })} />;
  }
  return <Workspace key={session.user.account_id} user={session.user} onLogout={onLogout} />;
}

function initials(fullName: string): string {
  return fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

function Workspace({ user, onLogout }: { user: User; onLogout: () => void }) {
  const pages = PAGES[user.role];
  const [page, setPage] = useState<Page>(pages[0]!);
  const [theme, toggleTheme] = useTheme();
  const info = PAGE_INFO[page];

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <LogoMark />
          <div>
            <strong>MedBase</strong>
            <span>Управление отделением</span>
          </div>
        </div>

        <nav className="nav" aria-label="Разделы">
          {pages.map((p) => {
            const { label, icon: NavIcon } = PAGE_INFO[p];
            return (
              <button
                key={p}
                type="button"
                className={p === page ? "nav-item nav-item-active" : "nav-item"}
                aria-current={p === page ? "page" : undefined}
                onClick={() => setPage(p)}
              >
                <NavIcon />
                <span>{label}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-foot">
          <SystemStatus />
          <div className="user-card">
            <span className="avatar" aria-hidden="true">
              {initials(user.full_name)}
            </span>
            <span className="user-text">
              <strong>{user.full_name}</strong>
              <span>{ROLE_LABELS[user.role]}</span>
            </span>
            <button
              type="button"
              className="icon-button"
              onClick={toggleTheme}
              title={theme === "dark" ? "Светлая тема" : "Тёмная тема"}
              aria-label={theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему"}
            >
              {theme === "dark" ? <SunIcon size={18} /> : <MoonIcon size={18} />}
            </button>
            <button type="button" className="icon-button" onClick={onLogout} title="Выйти" aria-label="Выйти">
              <LogoutIcon size={18} />
            </button>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="page-header">
          <div>
            <h1>{info.label}</h1>
            <p>{info.description(user.role)}</p>
          </div>
          <Clock />
        </header>

        {page === "admissions" && <AdmissionsPage />}
        {page === "post" && <NursePost headNurse={user.role === "HeadNurse"} />}
        {page === "report" && <ReportPage />}
        {page === "wards" && <WardBoard />}
        {page === "simulator" && <SimulatorPage />}
      </main>
    </div>
  );
}

const TIME = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" });
const DATE = new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" });

function Clock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="clock" aria-label="Текущее время">
      <strong>{TIME.format(now)}</strong>
      <span>{DATE.format(now)}</span>
    </div>
  );
}

type HealthState = { kind: "loading" } | { kind: "loaded"; health: Health } | { kind: "failed" };

function SystemStatus() {
  const [state, setState] = useState<HealthState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    const check = () =>
      getHealth()
        .then((health) => !cancelled && setState({ kind: "loaded", health }))
        .catch(() => !cancelled && setState({ kind: "failed" }));
    void check();
    const timer = window.setInterval(check, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const backend = state.kind === "loaded";
  const database = state.kind === "loaded" && state.health.database === "ok";
  const dot = (ok: boolean) => (state.kind === "loading" ? "dot" : ok ? "dot dot-ok" : "dot dot-down");
  const word = (ok: boolean) => (state.kind === "loading" ? "проверка…" : ok ? "работает" : "недоступна");

  return (
    <div className="system-status" aria-live="polite">
      <span>
        <span className={dot(backend)} /> Сервер: {word(backend)}
      </span>
      <span>
        <span className={dot(database)} /> База данных: {word(database)}
      </span>
    </div>
  );
}
