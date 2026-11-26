// "Назначения" screen (part 3, head nurse): the nurses × wards table, the rule
// "exactly one primary nurse per ward" as the screen enforces it, what each click sends
// to the API, how errors are shown, and the journal. The API is a fake fetch.

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AssignmentBoard, AssignmentLogEntry } from "./api";
import AssignmentsPage from "./AssignmentsPage";

// --- Test data (like db/04_seed.sql) ---------------------------------------------------------

const NURSES: AssignmentBoard["nurses"] = [
  { nurse_id: "NURSE-01", full_name: "Aigerim Sadykova", role: "Nurse", status: "Available" },
  { nurse_id: "NURSE-04", full_name: "Aliya Nurlanova", role: "Nurse", status: "Available" },
  { nurse_id: "NURSE-02", full_name: "Dinara Omarova", role: "Nurse", status: "Busy" },
  { nurse_id: "NURSE-10", full_name: "Gulnara Akhmetova", role: "HeadNurse", status: "Available" },
  { nurse_id: "NURSE-05", full_name: "Saule Bekova", role: "Nurse", status: "OffShift" },
];

function seedBoard(): AssignmentBoard {
  return {
    wards: [
      {
        ward_id: 101,
        ward_name: "ICU Unit A",
        primary_nurse_id: "NURSE-01",
        nurses: [
          { nurse_id: "NURSE-01", full_name: "Aigerim Sadykova", status: "Available", is_primary: true },
          { nurse_id: "NURSE-02", full_name: "Dinara Omarova", status: "Busy", is_primary: false },
        ],
      },
      {
        ward_id: 104,
        ward_name: "Emergency Overflow Ward",
        primary_nurse_id: "NURSE-04",
        nurses: [
          { nurse_id: "NURSE-04", full_name: "Aliya Nurlanova", status: "Available", is_primary: true },
          { nurse_id: "NURSE-05", full_name: "Saule Bekova", status: "OffShift", is_primary: false },
        ],
      },
    ],
    nurses: NURSES,
  };
}

const SWAP: AssignmentLogEntry = {
  log_id: 2,
  changed_at: "2026-11-26T10:15:30Z",
  ward_id: 101,
  ward_name: "ICU Unit A",
  action: "ASSIGN_PRIMARY",
  nurse_id: "NURSE-02",
  nurse_name: "Dinara Omarova",
  previous_primary_nurse_id: "NURSE-01",
  changed_by_nurse_id: "NURSE-10",
  changed_by_name: "Gulnara Akhmetova",
  reason: "Пересменка",
};

const HANDOFF: AssignmentLogEntry = {
  ...SWAP,
  log_id: 1,
  ward_id: 104,
  ward_name: "Emergency Overflow Ward",
  action: "AUTO_ASSIGN_PRIMARY",
  nurse_id: "NURSE-04",
  nurse_name: "Aliya Nurlanova",
  previous_primary_nurse_id: "NURSE-05",
  changed_by_nurse_id: null,
  changed_by_name: null,
  reason: null,
};

// --- Fake server -------------------------------------------------------------------------------

type Change = { method: string; url: string; body: unknown };
type ChangeReply = { status: number; body?: unknown } | Promise<never>;

function server({
  board = seedBoard(),
  log = [] as AssignmentLogEntry[],
  boardFails = false,
  onChange = (_change: Change): ChangeReply => ({ status: 200, body: board.wards[0] }),
} = {}) {
  const changes: Change[] = [];
  const reads: string[] = [];
  const json = (status: number, body: unknown) =>
    status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(body), { status });

  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method === "GET") {
      reads.push(url);
      if (url === "/api/assignments") {
        if (boardFails) throw new TypeError("Failed to fetch");
        return json(200, board);
      }
      if (url.startsWith("/api/assignments/log")) return json(200, log);
      return json(404, { detail: "unknown" });
    }
    const change = { method, url, body: init?.body ? JSON.parse(String(init.body)) : null };
    changes.push(change);
    const reply = await onChange(change);
    return json(reply.status, reply.body ?? null);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { changes, reads, setBoard: (next: AssignmentBoard) => (board = next), setLog: (next: AssignmentLogEntry[]) => (log = next) };
}

async function show(options?: Parameters<typeof server>[0]) {
  const fake = server(options);
  render(<AssignmentsPage />);
  await screen.findByRole("heading", { name: "Медсёстры и палаты" });
  return fake;
}

/** The "— / Доп. / Осн." switch of one nurse in one ward */
function cell(nurse: string, ward: string) {
  const group = screen.getByRole("radiogroup", { name: `${nurse}, ${ward}` });
  const option = (name: "—" | "Доп." | "Осн.") => within(group).getByRole("radio", { name }) as HTMLButtonElement;
  return {
    group,
    none: option("—"),
    additional: option("Доп."),
    primary: option("Осн."),
    checked: () => within(group).getAllByRole("radio").find((r) => r.getAttribute("aria-checked") === "true")?.textContent,
  };
}

afterEach(() => cleanup());

// --- The table ---------------------------------------------------------------------------------

describe("nurses × wards table", () => {
  it("marks the primary and additional nurses of every ward", async () => {
    await show();

    expect(cell("Aigerim Sadykova", "ICU Unit A").checked()).toBe("Осн.");
    expect(cell("Dinara Omarova", "ICU Unit A").checked()).toBe("Доп.");
    expect(cell("Aliya Nurlanova", "ICU Unit A").checked()).toBe("—");
    expect(cell("Aliya Nurlanova", "Emergency Overflow Ward").checked()).toBe("Осн.");
    expect(cell("Saule Bekova", "Emergency Overflow Ward").checked()).toBe("Доп.");
  });

  it("has a column for every ward and a row for every nurse, with her status", async () => {
    await show();

    expect(screen.getByRole("columnheader", { name: /ICU Unit A/ })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /Emergency Overflow Ward/ })).toBeTruthy();
    expect(screen.getAllByRole("radiogroup")).toHaveLength(NURSES.length * 2);
    const saule = screen.getByText("Saule Bekova").closest("tr")!;
    expect(within(saule).getByText("Не на смене")).toBeTruthy();
    const dinara = screen.getByText("Dinara Omarova").closest("tr")!;
    expect(within(dinara).getByText("Занята")).toBeTruthy();
    const gulnara = screen.getByText("Gulnara Akhmetova").closest("tr")!;
    expect(gulnara.textContent).toContain("старшая");
  });

  it("explains the rule above the table", async () => {
    await show();

    expect(screen.getByText(/ровно одна основная медсестра/)).toBeTruthy();
  });
});

// --- The rule: exactly one primary nurse -------------------------------------------------------

describe("one primary nurse per ward", () => {
  it("does not let the primary nurse be taken off or made additional", async () => {
    await show();
    const primary = cell("Aigerim Sadykova", "ICU Unit A");

    expect(primary.none.disabled).toBe(true);
    expect(primary.additional.disabled).toBe(true);
    expect(primary.none.title).toBe("Основную нельзя снять: назначьте другую основную");
  });

  it("does not let an off-shift nurse be assigned, but lets her be taken off", async () => {
    await show();

    const icu = cell("Saule Bekova", "ICU Unit A");
    expect(icu.additional.disabled).toBe(true);
    expect(icu.primary.disabled).toBe(true);
    expect(icu.primary.title).toBe("Медсестра не на смене");
    expect(cell("Saule Bekova", "Emergency Overflow Ward").none.disabled).toBe(false);
  });

  it("sends nothing when the current choice is clicked again", async () => {
    const fake = await show();

    fireEvent.click(cell("Aigerim Sadykova", "ICU Unit A").primary);

    expect(fake.changes).toEqual([]);
  });
});

// --- What each click sends ---------------------------------------------------------------------

describe("changes", () => {
  it("makes a nurse primary; the old one stays additional and new alerts go to the new one", async () => {
    const fake = await show();
    const after = seedBoard();
    after.wards[0]!.primary_nurse_id = "NURSE-02";
    after.wards[0]!.nurses = [
      { nurse_id: "NURSE-02", full_name: "Dinara Omarova", status: "Busy", is_primary: true },
      { nurse_id: "NURSE-01", full_name: "Aigerim Sadykova", status: "Available", is_primary: false },
    ];
    fake.setBoard(after);

    fireEvent.click(cell("Dinara Omarova", "ICU Unit A").primary);

    const notice = await screen.findByRole("status");
    expect(notice.textContent).toContain("Dinara Omarova — основная медсестра палаты «ICU Unit A»");
    expect(notice.textContent).toContain("Aigerim Sadykova осталась дополнительной");
    expect(notice.textContent).toContain("Новые оповещения палаты пойдут ей");
    expect(fake.changes).toEqual([
      { method: "PUT", url: "/api/assignments/101/primary", body: { nurse_id: "NURSE-02", reason: null } },
    ]);
    // The table is read again and shows the new state
    await waitFor(() => expect(cell("Dinara Omarova", "ICU Unit A").checked()).toBe("Осн."));
    expect(cell("Aigerim Sadykova", "ICU Unit A").checked()).toBe("Доп.");
  });

  it("adds an additional nurse", async () => {
    const fake = await show();

    fireEvent.click(cell("Aliya Nurlanova", "ICU Unit A").additional);

    expect((await screen.findByRole("status")).textContent).toContain(
      "Aliya Nurlanova добавлена в палату «ICU Unit A» дополнительной",
    );
    expect(fake.changes).toEqual([
      { method: "POST", url: "/api/assignments/101/nurses", body: { nurse_id: "NURSE-04", reason: null } },
    ]);
  });

  it("takes an additional nurse off the ward", async () => {
    const fake = await show({ onChange: () => ({ status: 204 }) });

    fireEvent.click(cell("Dinara Omarova", "ICU Unit A").none);

    expect((await screen.findByRole("status")).textContent).toContain("Dinara Omarova снята с палаты «ICU Unit A»");
    expect(fake.changes).toEqual([{ method: "DELETE", url: "/api/assignments/101/nurses/NURSE-02", body: null }]);
  });

  it("sends the reason with the change and clears it afterwards", async () => {
    const fake = await show({ onChange: () => ({ status: 204 }) });
    const reason = screen.getByLabelText(/Причина изменения/) as HTMLInputElement;

    fireEvent.change(reason, { target: { value: "  Пересменка  " } });
    fireEvent.click(cell("Dinara Omarova", "ICU Unit A").none);

    await screen.findByRole("status");
    expect(fake.changes[0]!.url).toBe("/api/assignments/101/nurses/NURSE-02?reason=%D0%9F%D0%B5%D1%80%D0%B5%D1%81%D0%BC%D0%B5%D0%BD%D0%BA%D0%B0");
    expect(reason.value).toBe("");
  });

  it("keeps the reason when the change is refused", async () => {
    await show({ onChange: () => ({ status: 409, body: { detail: "нельзя" } }) });
    const reason = screen.getByLabelText(/Причина изменения/) as HTMLInputElement;

    fireEvent.change(reason, { target: { value: "Пересменка" } });
    fireEvent.click(cell("Dinara Omarova", "ICU Unit A").primary);

    await screen.findByRole("alert");
    expect(reason.value).toBe("Пересменка");
  });

  it("locks the whole table while one change is being saved", async () => {
    let finish: (reply: { status: number }) => void = () => undefined;
    await show({ onChange: () => new Promise((resolve) => (finish = resolve)) as never });

    fireEvent.click(cell("Dinara Omarova", "ICU Unit A").primary);

    await waitFor(() => expect(cell("Aliya Nurlanova", "Emergency Overflow Ward").none.disabled).toBe(true));
    expect(cell("Aliya Nurlanova", "ICU Unit A").additional.disabled).toBe(true);
    expect(cell("Dinara Omarova", "ICU Unit A").group.getAttribute("aria-busy")).toBe("true");

    finish({ status: 200 });
    await waitFor(() => expect(cell("Aliya Nurlanova", "ICU Unit A").additional.disabled).toBe(false));
  });
});

// --- Errors ------------------------------------------------------------------------------------

describe("errors", () => {
  it("shows the server's reason when a change is refused, and reads the table again", async () => {
    const fake = await show({
      onChange: () => ({
        status: 409,
        body: { detail: "База данных отклонила операцию: Ward ID 101 must have exactly one primary nurse." },
      }),
    });
    const readsBefore = fake.reads.filter((u) => u === "/api/assignments").length;

    fireEvent.click(cell("Dinara Omarova", "ICU Unit A").primary);

    expect((await screen.findByRole("alert")).textContent).toBe(
      "База данных отклонила операцию: Ward ID 101 must have exactly one primary nurse.",
    );
    await waitFor(() =>
      expect(fake.reads.filter((u) => u === "/api/assignments").length).toBe(readsBefore + 1),
    );
    expect(cell("Aigerim Sadykova", "ICU Unit A").checked()).toBe("Осн.");
  });

  it("says so when the server cannot be reached", async () => {
    server({ boardFails: true });
    render(<AssignmentsPage />);

    expect((await screen.findByRole("alert")).textContent).toBe("Сервер недоступен");
  });
});

// --- The journal -------------------------------------------------------------------------------

describe("journal", () => {
  it("shows who changed what, when and why; automatic handoffs say so", async () => {
    await show({ log: [SWAP, HANDOFF] });

    const journal = screen.getByRole("heading", { name: "Журнал назначений" }).closest("section")!;
    const [, swap, handoff] = within(journal).getAllByRole("row");
    expect(swap!.textContent).toContain("ICU Unit A");
    expect(swap!.textContent).toContain("Новая основная");
    expect(swap!.textContent).toContain("вместо NURSE-01");
    expect(swap!.textContent).toContain("Dinara Omarova");
    expect(swap!.textContent).toContain("Gulnara Akhmetova");
    expect(swap!.textContent).toContain("Пересменка");
    expect(swap!.textContent).toMatch(/\d\d\.\d\d, \d\d:\d\d:\d\d/);
    expect(handoff!.textContent).toContain("Автоназначение основной");
    expect(handoff!.textContent).toContain("автоматически");
    expect(handoff!.textContent).toContain("—");
  });

  it("says when nothing has changed yet", async () => {
    await show({ log: [] });

    expect(screen.getByText("Изменений пока не было")).toBeTruthy();
  });

  it("asks for one ward's journal when a ward is chosen", async () => {
    const fake = await show();
    expect(fake.reads).toContain("/api/assignments/log?limit=50");

    fireEvent.change(screen.getByLabelText("Палата в журнале"), { target: { value: "101" } });

    await waitFor(() => expect(fake.reads).toContain("/api/assignments/log?limit=50&ward_id=101"));
  });

  it("shows the new entry after a change", async () => {
    const fake = await show({ log: [] });
    fake.setLog([SWAP]);

    fireEvent.click(cell("Dinara Omarova", "ICU Unit A").primary);

    await waitFor(() => expect(screen.getByText("Пересменка")).toBeTruthy());
  });
});
