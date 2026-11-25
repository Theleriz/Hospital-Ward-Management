import { useEffect, useState } from "react";

import { fetchSummary, NotAllowedError, type BoardAlert, type BoardSummary, type BoardWard } from "./api";

// Default until the server says otherwise (the task asks for every 1-2 seconds)
const DEFAULT_REFRESH_SECONDS = 1.5;
// No fresh data for this long = the connection is lost, and the board says so
const STALE_AFTER_MS = 5000;

type State =
  | { kind: "loading"; failed: boolean }
  | { kind: "forbidden" }
  | { kind: "ready"; summary: BoardSummary; receivedAt: number; failing: boolean };

const PRIORITY_LABELS: Record<BoardAlert["priority"], string> = {
  CRITICAL: "Критический",
  HIGH: "Высокий",
  LOW: "Низкий",
};

const TIME = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const CLOCK = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" });

function waited(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h} ч ${String(m).padStart(2, "0")} мин` : `${m}:${rest}`;
}

function beds(n: number): string {
  const tens = n % 100;
  const ones = n % 10;
  if (tens >= 11 && tens <= 14) return "мест";
  if (ones === 1) return "место";
  if (ones >= 2 && ones <= 4) return "места";
  return "мест";
}

/** Corridor board: occupancy and active alerts of every ward, no patient data. */
export default function CorridorBoard() {
  const [state, setState] = useState<State>({ kind: "loading", failed: false });
  const [now, setNow] = useState(() => Date.now());

  // Ask for a new summary every 1-2 seconds; keep the last data when a request fails
  useEffect(() => {
    let stopped = false;
    let timer = 0;

    const poll = async () => {
      let next = DEFAULT_REFRESH_SECONDS;
      try {
        const summary = await fetchSummary();
        next = summary.refresh_seconds;
        if (!stopped) setState({ kind: "ready", summary, receivedAt: Date.now(), failing: false });
      } catch (error) {
        if (stopped) return;
        if (error instanceof NotAllowedError) {
          setState({ kind: "forbidden" });
        } else {
          setState((s) => (s.kind === "ready" ? { ...s, failing: true } : { kind: "loading", failed: true }));
        }
      }
      if (!stopped) timer = window.setTimeout(poll, next * 1000);
    };

    void poll();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, []);

  // Waiting times and the clock move every second, between the server updates too
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (state.kind === "forbidden") {
    return (
      <main className="board board-message">
        <h1>Этот экран не допущен к табло</h1>
        <p>Табло открывается только во внутренней сети больницы или на зарегистрированном экране.</p>
      </main>
    );
  }

  const ready = state.kind === "ready" ? state : null;
  const neverLoaded = state.kind === "loading";
  const lost = state.kind === "loading" ? state.failed : state.failing && now - state.receivedAt > STALE_AFTER_MS;
  const elapsed = ready ? (now - ready.receivedAt) / 1000 : 0;
  const alerts = ready ? ready.summary.wards.reduce((n, w) => n + w.alerts.length, 0) : 0;

  return (
    <main className={lost ? "board board-lost" : "board"}>
      <header className="board-head">
        <div>
          <h1>Табло отделения</h1>
          <p>
            {neverLoaded
              ? "Подключение к серверу…"
              : alerts === 0
                ? "Активных оповещений нет"
                : `Активных оповещений: ${alerts}`}
          </p>
        </div>
        <div className="board-clock" aria-label="Текущее время">
          {CLOCK.format(now)}
        </div>
      </header>

      {lost && (
        <div className="board-banner" role="alert">
          <strong>Нет связи с сервером</strong>
          <span>
            {ready
              ? `Данные на ${TIME.format(ready.receivedAt)} могут быть устаревшими`
              : "Данных пока нет, табло подключится само, когда сервер станет доступен"}
          </span>
        </div>
      )}

      {ready && (
        <section className="board-grid" aria-label="Палаты">
          {ready.summary.wards.map((ward) => (
            <WardTile key={ward.ward_id} ward={ward} elapsed={lost ? 0 : elapsed} />
          ))}
        </section>
      )}

      <footer className="board-foot">
        <span>
          <span className={lost ? "board-dot board-dot-down" : "board-dot"} />
          {lost ? "Связь потеряна" : neverLoaded ? "Подключение…" : "На связи, обновление каждые 1–2 с"}
        </span>
        <span>Без данных пациентов</span>
      </footer>
    </main>
  );
}

function WardTile({ ward, elapsed }: { ward: BoardWard; elapsed: number }) {
  const full = ward.available === 0;
  const fill = ward.capacity ? Math.min(100, (ward.occupied / ward.capacity) * 100) : 0;
  const top = ward.alerts[0]?.priority;

  return (
    <article className={top ? `ward-tile ward-tile-${top}` : "ward-tile"} aria-label={ward.ward_name}>
      <div className="ward-tile-head">
        <h2>{ward.ward_name}</h2>
        <span className="ward-tile-floor">этаж {ward.floor}</span>
      </div>

      <div className="ward-tile-beds">
        <span className="ward-tile-count">
          {ward.occupied} / {ward.capacity}
        </span>
        <span className={full ? "ward-tile-free ward-tile-full" : "ward-tile-free"}>
          {full ? "мест нет" : `свободно ${ward.available} ${beds(ward.available)}`}
        </span>
      </div>
      <div className="ward-tile-meter" aria-hidden="true">
        <span style={{ width: `${fill}%` }} />
      </div>

      {ward.alerts.length === 0 ? (
        <p className="ward-tile-calm">Оповещений нет</p>
      ) : (
        <ul className="ward-tile-alerts">
          {ward.alerts.map((alert, i) => (
            <li key={i} className={`board-alert board-alert-${alert.priority}`}>
              <span className="board-alert-priority">{PRIORITY_LABELS[alert.priority]}</span>
              <span className="board-alert-wait">ждёт {waited(alert.waiting_seconds + elapsed)}</span>
              <span className="board-alert-tags">
                {alert.escalated && <span className="board-tag">Эскалировано</span>}
                {alert.outside_call && <span className="board-tag board-tag-call">Вызван персонал не из палаты</span>}
                {alert.no_nurse && <span className="board-tag board-tag-call">Никто на смене не назначен</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
