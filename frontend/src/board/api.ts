// Corridor board: the only request it makes (GET /api/board/summary, no login)

export type BoardPriority = "LOW" | "HIGH" | "CRITICAL";

export type BoardAlert = {
  priority: BoardPriority;
  status: "PENDING" | "ESCALATED";
  waiting_seconds: number;
  escalated: boolean;
  outside_call: boolean;
  no_nurse: boolean;
};

export type BoardWard = {
  ward_id: number;
  ward_name: string;
  floor: number;
  capacity: number;
  occupied: number;
  available: number;
  alerts: BoardAlert[];
};

export type BoardSummary = {
  generated_at: string;
  refresh_seconds: number;
  wards: BoardWard[];
};

/** The screen is not on the list of allowed networks or known screens */
export class NotAllowedError extends Error {}

// A known screen outside the internal network opens the board as /?screen=<token>
const screenToken = new URLSearchParams(window.location.search).get("screen");

const TIMEOUT_MS = 3000;

export async function fetchSummary(): Promise<BoardSummary> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch("/api/board/summary", {
      cache: "no-store",
      credentials: "omit",
      headers: screenToken ? { "X-Board-Screen": screenToken } : undefined,
      signal: controller.signal,
    });
    if (response.status === 403) throw new NotAllowedError();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as BoardSummary;
  } finally {
    window.clearTimeout(timer);
  }
}
