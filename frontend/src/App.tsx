import { Button } from "@heroui/react";
import { useEffect, useState, type ComponentType } from "react";

import AdmissionsPage from "./AdmissionsPage";
import AssignmentsPage from "./AssignmentsPage";
import BadgesPage from "./BadgesPage";
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
  AssignmentsIcon,
  BadgeIcon,
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
import StaffReviewPage from "./StaffReviewPage";
import { useTheme } from "./theme";
import WardBoard from "./WardBoard";

type Session = { kind: "checking" } | { kind: "anonymous" } | { kind: "signed-in"; user: User };

type Page = "admissions" | "post" | "report" | "assignments" | "badges" | "wards" | "simulator" | "reviews";

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
  assignments: {
    label: "Назначения",
    icon: AssignmentsIcon,
    description: () => "Кто работает в каких палатах: основная и дополнительные медсёстры",
  },
  badges: {
    label: "Бейджи",
    icon: BadgeIcon,
    description: () => "Печать бейджей со штрих-кодом и перевыпуск утерянных",
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
  reviews: {
    label: "На проверку",
    icon: AdmissionsIcon,
    description: () => "Заявки персонала по пациентам, требующим проверки",
  },
};

// Screens each role can open; the first one opens after login
const PAGES: Record<Role, Page[]> = {
  Admissions: ["admissions", "wards"],
  PublicStaff: ["wards"],
  Nurse: ["post", "wards", "simulator"],
  HeadNurse: ["report", "post", "assignments", "badges", "wards", "simulator"],
  Doctor: ["reviews"],
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
    return <div className="min-h-screen bg-[var(--bg)]" aria-busy="true" />;
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
    <div className="flex min-h-screen flex-col bg-[var(--bg)] lg:flex-row">
      {/* no-print: the badge print page shows only the badges (index.css, @media print) */}
      <aside className="no-print flex shrink-0 flex-col gap-6 border-r border-[var(--sidebar-border)] bg-[var(--sidebar)] px-4 py-5 text-[var(--sidebar-text)] lg:sticky lg:top-0 lg:h-screen lg:w-72">
        <div className="flex items-center gap-3 px-2">
          <LogoMark size={38} />
          <div className="flex flex-col leading-tight">
            <strong className="text-base text-white">MedBase</strong>
            <span className="text-xs text-[var(--sidebar-muted)]">Управление отделением</span>
          </div>
        </div>

        <nav className="flex flex-col gap-1" aria-label="Разделы">
          <span className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--sidebar-muted)]">
            Разделы
          </span>
          {pages.map((p) => {
            const { label, icon: NavIcon } = PAGE_INFO[p];
            const active = p === page;
            return (
              <button
                key={p}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => setPage(p)}
                className={
                  "relative flex min-h-0 w-full items-center gap-3 rounded-xl border-0 px-3 py-2.5 text-left text-sm font-medium transition-colors " +
                  (active
                    ? "bg-[var(--sidebar-active)] text-white hover:bg-[var(--sidebar-active)]"
                    : "bg-transparent text-[var(--sidebar-text)] hover:bg-[var(--sidebar-hover)] hover:text-white")
                }
              >
                {active && (
                  <span aria-hidden="true" className="absolute inset-y-2 left-0 w-1 rounded-full bg-[var(--brand)]" />
                )}
                <span className={active ? "text-[#5fd3c9]" : "text-[var(--sidebar-muted)]"}>
                  <NavIcon />
                </span>
                <span>{label}</span>
              </button>
            );
          })}
        </nav>

        <div className="mt-auto flex flex-col gap-3">
          <SystemStatus />
          <div className="flex items-center gap-3 rounded-2xl bg-white/5 p-3 ring-1 ring-white/10">
            <span
              aria-hidden="true"
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--brand)] to-sky-600 text-sm font-bold text-white"
            >
              {initials(user.full_name)}
            </span>
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <strong className="truncate text-sm text-white">{user.full_name}</strong>
              <span className="truncate text-xs text-[var(--sidebar-muted)]">{ROLE_LABELS[user.role]}</span>
            </span>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              onPress={toggleTheme}
              aria-label={theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему"}
              className="text-[var(--sidebar-text)] hover:bg-white/10 hover:text-white"
            >
              {theme === "dark" ? <SunIcon size={18} /> : <MoonIcon size={18} />}
            </Button>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              onPress={onLogout}
              aria-label="Выйти"
              className="text-[var(--sidebar-text)] hover:bg-white/10 hover:text-white"
            >
              <LogoutIcon size={18} />
            </Button>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-5 py-6 print:bg-white print:p-0 lg:px-10 lg:py-8">
        <header className="no-print mb-6 flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="m-0 text-3xl font-bold tracking-tight text-[var(--text)]">{info.label}</h1>
            <p className="m-0 text-sm text-[var(--muted)]">{info.description(user.role)}</p>
          </div>
          <Clock />
        </header>

        {page === "admissions" && <AdmissionsPage />}
        {page === "post" && <NursePost headNurse={user.role === "HeadNurse"} />}
        {page === "report" && <ReportPage />}
        {page === "assignments" && <AssignmentsPage />}
        {page === "badges" && <BadgesPage />}
        {page === "wards" && <WardBoard />}
        {page === "simulator" && <SimulatorPage />}
        {page === "reviews" && <StaffReviewPage />}
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
    <div
      className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2 shadow-sm"
      aria-label="Текущее время"
    >
      <strong className="text-2xl font-bold tabular-nums text-[var(--text)]">{TIME.format(now)}</strong>
      <span className="text-xs leading-tight text-[var(--muted)] first-letter:uppercase">{DATE.format(now)}</span>
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
  const word = (ok: boolean) => (state.kind === "loading" ? "проверка…" : ok ? "работает" : "недоступна");
  const dot = (ok: boolean) =>
    "size-2 rounded-full " +
    (state.kind === "loading" ? "bg-[var(--sidebar-muted)]" : ok ? "bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400/60" : "bg-red-500");

  return (
    <div className="flex flex-col gap-1.5 px-3 text-xs text-[var(--sidebar-muted)]" aria-live="polite">
      <span className="flex items-center gap-2">
        <span className={dot(backend)} /> Сервер: {word(backend)}
      </span>
      <span className="flex items-center gap-2">
        <span className={dot(database)} /> База данных: {word(database)}
      </span>
    </div>
  );
}
