// Corridor board end to end (part 4), in a real browser against the running system:
// an alert raised by a device reaches the board in the corridor within the refresh time,
// shows no patient data there, and leaves the board once a nurse acknowledges it.

import { expect, test, type Page } from "@playwright/test";

import { chooseOption, BOARD_URL, NURSE_4, openSection, signIn, wardTile } from "./helpers";

const WARD = "Emergency Overflow Ward"; // ward 104, no alerts in the seed data
// The board asks every 1.5 s; allow one missed answer on a slow CI machine
const BOARD_REFRESH_MS = 3_000;

async function openBoard(page: Page) {
  await page.goto(BOARD_URL);
  await expect(page.getByRole("heading", { name: "Табло отделения" })).toBeVisible();
  await expect(page.getByText("На связи, обновление каждые 1–2 с")).toBeVisible();
}

test("the board opens without login and shows every ward", async ({ page }) => {
  await openBoard(page);

  for (const ward of ["ICU Unit A", "General Medical Ward 1", "Surgical Recovery Ward", WARD]) {
    await expect(page.getByRole("article", { name: ward })).toBeVisible();
  }
  await expect(wardTile(page, "ICU Unit A").tile).toContainText("2 / 2");
  await expect(page.getByText("Без данных пациентов")).toBeVisible();
});

test("a new alert reaches the board, without patient data, and leaves it when acknowledged", async ({
  page,
  browser,
}) => {
  const board = await browser.newPage();
  await openBoard(board);
  const { alerts } = wardTile(board, WARD);
  const before = await alerts.count();

  // A call button in ward 104 (the simulator stands in for the device)
  const description = `E2E ${Date.now()}: пациентка Тестова просит помощи`;
  await signIn(page, NURSE_4);
  await openSection(page, "Симулятор устройств");
  await chooseOption(page, "Палата", WARD);
  await page.getByRole("radio", { name: /Кнопка вызова/ }).click();
  await page.getByRole("radio", { name: /CRITICAL/ }).click();
  await page.getByLabel("Описание (необязательно)").fill(description);
  await page.getByRole("button", { name: "Создать оповещение" }).click();
  await expect(page.getByRole("status")).toContainText("создано, назначено: NURSE-04");

  // The board shows it within the refresh time: priority and waiting time, nothing else
  await expect(alerts).toHaveCount(before + 1, { timeout: BOARD_REFRESH_MS });
  await expect(alerts.first()).toContainText("Критический");
  await expect(alerts.first()).toContainText(/ждёт \d+:\d\d/);
  await expect(wardTile(board, WARD).tile).toHaveClass(/ward-tile-CRITICAL/);
  const boardText = await board.locator("body").innerText();
  expect(boardText).not.toContain(description);
  expect(boardText).not.toContain("Тестова");
  expect(boardText).not.toContain("NURSE-04");
  expect(boardText).not.toMatch(/ALT-\d+/);

  // The nurse acknowledges it on her post; the board drops it
  await openSection(page, "Пост медсестры");
  const card = page.locator("article", { hasText: description });
  await card.getByRole("button", { name: "Подтвердить" }).click();
  await expect(alerts).toHaveCount(before, { timeout: BOARD_REFRESH_MS });

  await board.close();
});

test("the board shows a lost connection and recovers by itself", async ({ page }) => {
  await openBoard(page);

  // The network drops: every request for the summary fails
  await page.route("**/api/board/summary", (route) => route.abort("internetdisconnected"));
  const banner = page.getByRole("alert");
  await expect(banner).toContainText("Нет связи с сервером", { timeout: 8_000 });
  await expect(banner).toContainText(/Данные на \d\d:\d\d:\d\d/);
  await expect(page.getByRole("article", { name: WARD })).toBeVisible();

  // The network is back
  await page.unroute("**/api/board/summary");
  await expect(banner).toHaveCount(0, { timeout: BOARD_REFRESH_MS });
  await expect(page.getByText("На связи, обновление каждые 1–2 с")).toBeVisible();
});

test("the board port serves nothing of the staff app, the staff port no board summary", async ({ request }) => {
  expect((await request.get(`${BOARD_URL}/api/auth/me`)).status()).toBe(404);
  expect((await request.get(`${BOARD_URL}/api/admissions/active`)).status()).toBe(404);
  expect((await request.post(`${BOARD_URL}/api/board/summary`)).status()).toBe(403);
  expect((await request.get("/api/board/summary")).status()).toBe(404);
});
