import { expect, type Page } from "@playwright/test";

export const BOARD_URL = process.env.MEDBASE_E2E_BOARD_URL ?? "http://127.0.0.1:8081";

// Test accounts from db/04_seed.sql (development data only)
export const NURSE_4 = { badge: "BADGE-1004", pin: "4444" }; // primary nurse of ward 104
export const HEAD_NURSE = { badge: "BADGE-1010", pin: "1010" };

export async function signIn(page: Page, account: { badge: string; pin: string }) {
  await page.goto("/");
  await page.getByLabel("Бейдж").fill(account.badge);
  await page.getByLabel("PIN").fill(account.pin);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page.getByRole("navigation", { name: "Разделы" })).toBeVisible();
}

export async function openSection(page: Page, name: string) {
  await page.getByRole("navigation", { name: "Разделы" }).getByRole("button", { name }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

/** The corridor board's tile of a ward and its active alerts. */
export function wardTile(board: Page, wardName: string) {
  const tile = board.getByRole("article", { name: wardName });
  return { tile, alerts: tile.getByRole("listitem") };
}
