// The board's only request: a known screen passes its token from the address it was opened with.

import { afterEach, describe, expect, it, vi } from "vitest";

async function loadApi(search: string) {
  window.history.replaceState(null, "", `/${search}`);
  vi.resetModules();
  return import("./api");
}

function fakeFetch(status = 200) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
    new Response(JSON.stringify({ generated_at: "", refresh_seconds: 1.5, wards: [] }), { status }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => window.history.replaceState(null, "", "/"));

describe("fetchSummary", () => {
  it("sends the screen token from /?screen=… as X-Board-Screen", async () => {
    const fetchMock = fakeFetch();
    const api = await loadApi("?screen=corridor-2nd-floor");

    await api.fetchSummary();

    expect(fetchMock.mock.calls[0]![1]?.headers).toEqual({ "X-Board-Screen": "corridor-2nd-floor" });
  });

  it("sends no token header on a screen in the internal network", async () => {
    const fetchMock = fakeFetch();
    const api = await loadApi("");

    await api.fetchSummary();

    expect(fetchMock.mock.calls[0]![1]?.headers).toBeUndefined();
  });

  it("turns 403 into NotAllowedError and other errors into a plain error", async () => {
    let api = await loadApi("");
    fakeFetch(403);
    await expect(api.fetchSummary()).rejects.toBeInstanceOf(api.NotAllowedError);

    api = await loadApi("");
    fakeFetch(502);
    await expect(api.fetchSummary()).rejects.toThrow("HTTP 502");
  });

  it("gives up on a hanging request after 3 seconds", async () => {
    vi.useFakeTimers();
    try {
      const api = await loadApi("");
      vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))),
      ));

      const request = api.fetchSummary();
      const check = expect(request).rejects.toThrow("aborted");
      await vi.advanceTimersByTimeAsync(3000);
      await check;
    } finally {
      vi.useRealTimers();
    }
  });
});
