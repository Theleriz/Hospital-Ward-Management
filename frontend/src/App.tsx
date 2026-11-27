import { Button, Drawer, Kbd, Modal } from "@heroui/react";
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
  MenuIcon,
  MoonIcon,
  PostIcon,
  ReportIcon,
  SearchIcon,
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const info = PAGE_INFO[page];
  const PageIcon = info.icon;

  // Ctrl+K / Cmd+K opens the command palette from anywhere
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function go(next: Page) {
    setPage(next);
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const userCard = (
    <div className="flex items-center gap-3 rounded-2xl bg-white/5 p-3 ring-1 ring-white/10">
      <span
        aria-hidden="true"
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--brand)] to-sky-600 text-sm font-bold text-white shadow-lg shadow-teal-900/40"
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
  );

  const sidebar = (
    <>
      <div className="flex items-center gap-3 px-2">
        <span className="relative">
          <span aria-hidden="true" className="absolute inset-0 rounded-xl bg-[var(--brand)] opacity-60 blur-md" />
          <span className="relative block">
            <LogoMark size={38} />
          </span>
        </span>
        <div className="flex flex-col leading-tight">
          <strong className="text-base text-white">MedBase</strong>
          <span className="text-xs text-[var(--sidebar-muted)]">Управление отделением</span>
        </div>
      </div>

      <button
        type="button"
        onClick={() => {
          setMenuOpen(false);
          setPaletteOpen(true);
        }}
        className="flex min-h-0 w-full items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left text-sm font-normal text-[var(--sidebar-muted)] transition-colors hover:border-white/20 hover:bg-white/10 hover:text-white"
      >
        <SearchIcon size={16} />
        <span className="flex-1">Поиск и команды</span>
        <Kbd className="bg-white/10 text-[var(--sidebar-text)]">
          <Kbd.Abbr keyValue="ctrl" />
          <Kbd.Content>K</Kbd.Content>
        </Kbd>
      </button>

      <NavList pages={pages} current={page} onSelect={go} />

      <div className="mt-auto flex flex-col gap-3">
        <SystemStatus />
        {userCard}
      </div>
    </>
  );

  return (
    <div className="relative flex min-h-screen flex-col bg-[var(--bg)] lg:flex-row">
      {/* Ambient backdrop: brand glow and a faint dot grid, behind everything */}
      <div aria-hidden="true" className="no-print pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -right-32 -top-40 size-[520px] rounded-full bg-[var(--brand)] opacity-[0.10] blur-3xl" />
        <div className="absolute -bottom-48 left-1/3 size-[480px] rounded-full bg-sky-500 opacity-[0.07] blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(var(--border-strong)_1px,transparent_1px)] [background-size:24px_24px] opacity-40 [mask-image:linear-gradient(to_bottom,black,transparent_60%)]" />
      </div>

      {/* Phone and tablet: top bar with the menu button */}
      <div className="no-print sticky top-0 z-20 flex items-center gap-3 border-b border-[var(--sidebar-border)] bg-[var(--sidebar)]/95 px-4 py-3 backdrop-blur lg:hidden">
        <Button
          isIconOnly
          variant="ghost"
          aria-label="Открыть меню"
          onPress={() => setMenuOpen(true)}
          className="text-white hover:bg-white/10"
        >
          <MenuIcon size={20} />
        </Button>
        <LogoMark size={30} />
        <strong className="flex-1 truncate text-white">{info.label}</strong>
        <Button
          isIconOnly
          variant="ghost"
          aria-label="Поиск и команды"
          onPress={() => setPaletteOpen(true)}
          className="text-white hover:bg-white/10"
        >
          <SearchIcon size={18} />
        </Button>
      </div>

      {/* Desktop: fixed sidebar. no-print: the badge print page shows only the badges */}
      <aside className="no-print relative z-10 hidden shrink-0 flex-col gap-5 border-r border-[var(--sidebar-border)] bg-[var(--sidebar)] px-4 py-5 text-[var(--sidebar-text)] lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-72">
        {sidebar}
      </aside>

      <Drawer.Backdrop isOpen={menuOpen} onOpenChange={setMenuOpen}>
        <Drawer.Content placement="left">
          <Drawer.Dialog
            aria-label="Меню"
            className="flex h-full w-72 max-w-[85vw] flex-col gap-5 bg-[var(--sidebar)] px-4 py-5 text-[var(--sidebar-text)]"
          >
            {sidebar}
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>

      <CommandPalette
        isOpen={paletteOpen}
        onOpenChange={setPaletteOpen}
        pages={pages}
        onGo={go}
        theme={theme}
        onToggleTheme={toggleTheme}
        onLogout={onLogout}
      />

      <main className="relative z-10 min-w-0 flex-1 px-5 py-6 print:bg-white print:p-0 lg:px-10 lg:py-8">
        <header className="no-print mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="hidden size-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--brand)] to-sky-600 text-white shadow-lg shadow-teal-900/20 sm:flex">
              <PageIcon size={24} />
            </span>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                MedBase · {ROLE_LABELS[user.role]}
              </span>
              <h1 className="m-0 text-3xl font-bold tracking-tight text-[var(--text)]">{info.label}</h1>
              <p className="m-0 text-sm text-[var(--muted)]">{info.description(user.role)}</p>
            </div>
          </div>
          <Clock />
        </header>

        {/* key: every screen fades in when it opens */}
        <div key={page} className="animate-in fade-in slide-in-from-bottom-2 duration-300">
          {page === "admissions" && <AdmissionsPage />}
          {page === "post" && <NursePost headNurse={user.role === "HeadNurse"} />}
          {page === "report" && <ReportPage />}
          {page === "assignments" && <AssignmentsPage />}
          {page === "badges" && <BadgesPage />}
          {page === "wards" && <WardBoard />}
          {page === "simulator" && <SimulatorPage />}
          {page === "reviews" && <StaffReviewPage />}
        </div>
      </main>
    </div>
  );
}

function NavList({ pages, current, onSelect }: { pages: Page[]; current: Page; onSelect: (page: Page) => void }) {
  return (
    <nav className="flex flex-col gap-1" aria-label="Разделы">
      <span className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--sidebar-muted)]">
        Разделы
      </span>
      {pages.map((p) => {
        const { label, icon: NavIcon } = PAGE_INFO[p];
        const active = p === current;
        return (
          <button
            key={p}
            type="button"
            aria-current={active ? "page" : undefined}
            onClick={() => onSelect(p)}
            className={
              "group relative flex min-h-0 w-full items-center gap-3 rounded-xl border-0 px-3 py-2.5 text-left text-sm font-medium transition-all " +
              (active
                ? "bg-gradient-to-r from-[var(--sidebar-active)] to-transparent text-white hover:bg-[var(--sidebar-active)]"
                : "bg-transparent text-[var(--sidebar-text)] hover:translate-x-0.5 hover:bg-[var(--sidebar-hover)] hover:text-white")
            }
          >
            {active && (
              <span
                aria-hidden="true"
                className="absolute inset-y-2 left-0 w-1 rounded-full bg-[var(--brand)] shadow-[0_0_12px] shadow-teal-400/70"
              />
            )}
            <span className={active ? "text-[#5fd3c9]" : "text-[var(--sidebar-muted)] group-hover:text-[#5fd3c9]"}>
              <NavIcon />
            </span>
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}

type Command = { id: string; label: string; hint: string; icon: ComponentType<{ size?: number }>; run: () => void };

/** Ctrl+K: jump to any screen or run an action by typing a few letters. */
function CommandPalette({
  isOpen,
  onOpenChange,
  pages,
  onGo,
  theme,
  onToggleTheme,
  onLogout,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  pages: Page[];
  onGo: (page: Page) => void;
  theme: string;
  onToggleTheme: () => void;
  onLogout: () => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setActive(0);
    }
  }, [isOpen]);

  const commands: Command[] = [
    ...pages.map((p) => ({
      id: p,
      label: PAGE_INFO[p].label,
      hint: "Перейти",
      icon: PAGE_INFO[p].icon,
      run: () => onGo(p),
    })),
    {
      id: "theme",
      label: theme === "dark" ? "Светлая тема" : "Тёмная тема",
      hint: "Оформление",
      icon: theme === "dark" ? SunIcon : MoonIcon,
      run: onToggleTheme,
    },
    { id: "logout", label: "Выйти", hint: "Сессия", icon: LogoutIcon, run: onLogout },
  ];
  const needle = query.trim().toLowerCase();
  const shown = commands.filter((c) => !needle || c.label.toLowerCase().includes(needle));
  const current = Math.min(active, Math.max(shown.length - 1, 0));

  function run(command: Command | undefined) {
    if (!command) return;
    onOpenChange(false);
    command.run();
  }

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange} className="backdrop-blur-sm">
      <Modal.Container placement="top" size="md">
        <Modal.Dialog aria-label="Поиск и команды" className="overflow-hidden p-0">
          <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3">
            <span className="text-[var(--muted)]">
              <SearchIcon size={18} />
            </span>
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((i) => Math.min(i + 1, shown.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((i) => Math.max(i - 1, 0));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  run(shown[current]);
                }
              }}
              placeholder="Раздел или действие…"
              aria-label="Поиск раздела или действия"
              className="h-9 flex-1 border-0 bg-transparent p-0 text-base text-[var(--text)] shadow-none outline-none focus:shadow-none"
            />
            <Kbd>
              <Kbd.Content>Esc</Kbd.Content>
            </Kbd>
          </div>
          <ul className="m-0 flex max-h-80 list-none flex-col gap-0.5 overflow-y-auto p-2" role="listbox" aria-label="Команды">
            {shown.length === 0 && <li className="px-3 py-6 text-center text-sm text-[var(--muted)]">Ничего не найдено</li>}
            {shown.map((c, i) => {
              const Icon = c.icon;
              const selected = i === current;
              return (
                <li key={c.id} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => run(c)}
                    className={`flex min-h-0 w-full items-center gap-3 rounded-xl border-0 px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                      selected
                        ? "bg-[var(--accent-bg)] text-[var(--text)] hover:bg-[var(--accent-bg)]"
                        : "bg-transparent text-[var(--text)] hover:bg-[var(--surface-2)]"
                    }`}
                  >
                    <span
                      className={`flex size-8 items-center justify-center rounded-lg ${
                        selected ? "bg-[var(--accent)] text-white" : "bg-[var(--surface-2)] text-[var(--muted)]"
                      }`}
                    >
                      <Icon size={16} />
                    </span>
                    <span className="flex-1">{c.label}</span>
                    <span className="text-xs text-[var(--muted)]">{c.hint}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="flex items-center gap-4 border-t border-[var(--border)] px-4 py-2 text-xs text-[var(--muted)]">
            <span>↑↓ выбрать</span>
            <span>Enter открыть</span>
            <span className="ml-auto">MedBase</span>
          </div>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
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
