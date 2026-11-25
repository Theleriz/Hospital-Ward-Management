// Corridor board screen (part 4): what the screen in the corridor shows, how often it asks
// the server, and that a lost connection is shown clearly. The API is a fake fetch;
// timers are fake, so seconds pass instantly.

import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BoardAlert, BoardSummary, BoardWard } from "./api";
import CorridorBoard from "./CorridorBoard";

// --- Test data ---------------------------------------------------------------------------

function alert(fields: Partial<BoardAlert> = {}): BoardAlert {
  return {
    priority: "HIGH",
    status: "PENDING",
    waiting_seconds: 65,
    escalated: false,
    outside_call: false,
    no_nurse: false,
    ...fields,
  };
}

function ward(fields: Partial<BoardWard> = {}): BoardWard {
  return {
    ward_id: 101,
    ward_name: "ICU Unit A",
    floor: 1,
    capacity: 2,
    occupied: 2,
    available: 0,
    alerts: [],
    ...fields,
  };
}

function summary(wards: BoardWard[], refresh_seconds = 1.5): BoardSummary {
  return { generated_at: "2026-11-26T10:00:00Z", refresh_seconds, wards };
}

const ICU_WITH_ALERTS = summary([
  ward({
    alerts: [
      alert({ priority: "CRITICAL", status: "ESCALATED", waiting_seconds: 3725, escalated: true, outside_call: true }),
      alert({ priority: "HIGH", waiting_seconds: 65 }),
    ],
  }),
  ward({ ward_id: 104, ward_name: "Emergency Overflow Ward", capacity: 5, occupied: 0, available: 5 }),
]);

// --- Fake server ---------------------------------------------------------------------------

type Reply = BoardSummary | "down" | 403;

/** Every request gets the next reply; the last one repeats. */
function server(...replies: Reply[]) {
  const queue = [...replies];
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
    const reply = queue.length > 1 ? queue.shift()! : queue[0]!;
    if (reply === "down") throw new TypeError("Failed to fetch");
    if (reply === 403) return new Response(JSON.stringify({ detail: "no" }), { status: 403 });
    return new Response(JSON.stringify(reply), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    fetchMock,
    /** Replace what the server answers from now on */
    reply: (...next: Reply[]) => queue.splice(0, queue.length, ...next),
  };
}

async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function show(...replies: Reply[]) {
  const fake = server(...replies);
  render(<CorridorBoard />);
  await wait(0);
  return fake;
}

const tile = (name: string) => screen.getByRole("article", { name });
const banner = () => screen.queryByRole("alert");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  // Local time: the board shows the time of the screen's own clock
  vi.setSystemTime(new Date(2026, 10, 26, 10, 0, 0));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// --- What the board shows ------------------------------------------------------------------

describe("wards and alerts", () => {
  it("shows every ward with its occupancy", async () => {
    await show(ICU_WITH_ALERTS);

    expect(within(tile("ICU Unit A")).getByText("2 / 2")).toBeTruthy();
    expect(within(tile("ICU Unit A")).getByText("мест нет")).toBeTruthy();
    expect(within(tile("Emergency Overflow Ward")).getByText("0 / 5")).toBeTruthy();
    expect(within(tile("Emergency Overflow Ward")).getByText("свободно 5 мест")).toBeTruthy();
  });

  it.each([
    [1, "свободно 1 место"],
    [2, "свободно 2 места"],
    [4, "свободно 4 места"],
    [5, "свободно 5 мест"],
    [11, "свободно 11 мест"],
    [21, "свободно 21 место"],
  ])("writes %i free beds as «%s»", async (available, text) => {
    await show(summary([ward({ capacity: 30, occupied: 30 - available, available })]));

    expect(screen.getByText(text)).toBeTruthy();
  });

  it("shows priority, waiting time and what happened to each alert", async () => {
    await show(ICU_WITH_ALERTS);

    const [critical, high] = within(tile("ICU Unit A")).getAllByRole("listitem");
    expect(critical!.textContent).toContain("Критический");
    expect(critical!.textContent).toContain("ждёт 1 ч 02 мин");
    expect(critical!.textContent).toContain("Эскалировано");
    expect(critical!.textContent).toContain("Вызван персонал не из палаты");
    expect(critical!.className).toContain("board-alert-CRITICAL");
    expect(high!.textContent).toContain("Высокий");
    expect(high!.textContent).toContain("ждёт 1:05");
    expect(high!.textContent).not.toContain("Эскалировано");
  });

  it("marks an alert nobody on shift was given", async () => {
    await show(summary([ward({ alerts: [alert({ no_nurse: true })] })]));

    expect(screen.getByText("Никто на смене не назначен")).toBeTruthy();
  });

  it("colours the ward by its most urgent alert", async () => {
    await show(ICU_WITH_ALERTS);

    expect(tile("ICU Unit A").className).toContain("ward-tile-CRITICAL");
    expect(tile("Emergency Overflow Ward").className).not.toMatch(/ward-tile-(CRITICAL|HIGH|LOW)/);
  });

  it("says when there are no alerts", async () => {
    await show(summary([ward()]));

    expect(screen.getByText("Активных оповещений нет")).toBeTruthy();
    expect(screen.getByText("Оповещений нет")).toBeTruthy();
  });

  it("counts active alerts in the header", async () => {
    await show(ICU_WITH_ALERTS);

    expect(screen.getByText("Активных оповещений: 2")).toBeTruthy();
  });
});

// --- Time and refresh ----------------------------------------------------------------------

describe("refresh", () => {
  it("asks the server again every refresh_seconds (1–2 s)", async () => {
    const { fetchMock } = await show(summary([ward()], 1.5));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await wait(1500);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await wait(1500 * 4);
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("asks only for the summary, without cookies and without caching", async () => {
    const { fetchMock } = await show(summary([ward()]));

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/board/summary");
    expect(init?.credentials).toBe("omit");
    expect(init?.cache).toBe("no-store");
  });

  it("keeps the waiting time running between server updates", async () => {
    await show(summary([ward({ alerts: [alert({ waiting_seconds: 65 })] })], 2));
    expect(screen.getByText("ждёт 1:05")).toBeTruthy();

    await wait(1000);

    expect(screen.getByText("ждёт 1:06")).toBeTruthy();
  });

  it("shows new data as soon as it comes", async () => {
    const fake = await show(summary([ward()]));
    fake.reply(ICU_WITH_ALERTS);

    await wait(1500);

    expect(screen.getByText("Активных оповещений: 2")).toBeTruthy();
  });
});

// --- Lost connection -----------------------------------------------------------------------

describe("connection", () => {
  it("shows clearly that the server is lost, with the time of the last data", async () => {
    const fake = await show(ICU_WITH_ALERTS);
    fake.reply("down");

    await wait(6000);

    expect(banner()?.textContent).toContain("Нет связи с сервером");
    expect(banner()?.textContent).toContain("Данные на 10:00:00");
    expect(screen.getByText("Связь потеряна")).toBeTruthy();
    expect(screen.getByRole("main").className).toContain("board-lost");
    // The old data stays visible, dimmed
    expect(tile("ICU Unit A")).toBeTruthy();
  });

  it("does not raise the alarm for one failed request", async () => {
    const fake = await show(ICU_WITH_ALERTS);
    fake.reply("down", ICU_WITH_ALERTS);

    await wait(1500 * 3);

    expect(banner()).toBeNull();
  });

  it("does not raise the alarm before 5 seconds without data", async () => {
    const fake = await show(ICU_WITH_ALERTS);
    fake.reply("down");

    await wait(4000);

    expect(banner()).toBeNull();
  });

  it("recovers by itself when the server is back", async () => {
    const fake = await show(ICU_WITH_ALERTS);
    fake.reply("down");
    await wait(6000);
    expect(banner()).not.toBeNull();

    fake.reply(summary([ward()]));
    await wait(1500);

    expect(banner()).toBeNull();
    expect(screen.getByText("На связи, обновление каждые 1–2 с")).toBeTruthy();
    expect(screen.getByText("Активных оповещений нет")).toBeTruthy();
  });

  it("shows the lost connection even when there was never any data", async () => {
    await show("down");

    expect(banner()?.textContent).toContain("Нет связи с сервером");
    expect(banner()?.textContent).toContain("Данных пока нет");
  });

  it("keeps trying while the server is down", async () => {
    const { fetchMock } = await show("down");

    await wait(1500 * 3);

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

// --- Not allowed -----------------------------------------------------------------------------

describe("access", () => {
  it("tells a screen that is not allowed, and shows no data", async () => {
    await show(403);

    expect(screen.getByRole("heading", { name: "Этот экран не допущен к табло" })).toBeTruthy();
    expect(screen.queryByRole("article")).toBeNull();
  });
});
