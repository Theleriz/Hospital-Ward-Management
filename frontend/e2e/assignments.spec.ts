// "Назначения" end to end (part 3), in a real browser against the running system:
// the head nurse makes another nurse primary in a ward, the change is in the journal,
// and the next alert of that ward goes to the new primary nurse and shows on her post.

import { expect, test, type Page } from "@playwright/test";

import { chooseOption, HEAD_NURSE, NURSE_3, NURSE_4, openSection, signIn } from "./helpers";

const WARD = "Emergency Overflow Ward"; // ward 104: NURSE-04 is primary in the seed data
const WARD_ID = 104;

function cell(page: Page, nurse: string, ward = WARD) {
  const group = page.getByRole("radiogroup", { name: `${nurse}, ${ward}` });
  return {
    group,
    none: group.getByRole("radio", { name: "—" }),
    additional: group.getByRole("radio", { name: "Доп." }),
    primary: group.getByRole("radio", { name: "Осн." }),
  };
}

// Other tests (the corridor board) expect NURSE-04 to be the primary nurse of ward 104 again
test.afterEach(async ({ request }) => {
  await request.post("/api/auth/login", { data: { badge_id: HEAD_NURSE.badge, pin: HEAD_NURSE.pin } });
  await request.put(`/api/assignments/${WARD_ID}/primary`, {
    data: { nurse_id: "NURSE-04", reason: "E2E: back to the seed state" },
  });
  await request.post("/api/auth/logout");
});

test("only the head nurse has the Assignments screen", async ({ page }) => {
  await signIn(page, NURSE_4);

  await expect(page.getByRole("navigation", { name: "Разделы" }).getByRole("button", { name: "Назначения" })).toHaveCount(0);
  expect((await page.request.get("/api/assignments")).status()).toBe(403);
});

test("the primary nurse cannot be taken off, only replaced", async ({ page }) => {
  await signIn(page, HEAD_NURSE);
  await openSection(page, "Назначения");

  const aliya = cell(page, "Aliya Nurlanova");
  await expect(aliya.primary).toHaveAttribute("aria-checked", "true");
  await expect(aliya.none).toBeDisabled();
  await expect(aliya.additional).toBeDisabled();
  // The hint is on the label: a disabled button gets no pointer events
  await expect(aliya.none.locator("[title]")).toHaveAttribute("title", "Основную нельзя снять: назначьте другую основную");
});

test("a new primary nurse gets the ward's next alert, and the change is in the journal", async ({ page }) => {
  const reason = `E2E ${Date.now()} пересменка`;

  // 1. The head nurse makes Madina (NURSE-03) primary in ward 104
  await signIn(page, HEAD_NURSE);
  await openSection(page, "Назначения");
  await page.getByLabel(/Причина изменения/).fill(reason);
  await cell(page, "Madina Tulegenova").primary.click();

  await expect(page.getByRole("status")).toContainText(`Madina Tulegenova — основная медсестра палаты «${WARD}»`);
  await expect(page.getByRole("status")).toContainText("Aliya Nurlanova осталась дополнительной");
  await expect(cell(page, "Madina Tulegenova").primary).toHaveAttribute("aria-checked", "true");
  await expect(cell(page, "Aliya Nurlanova").additional).toHaveAttribute("aria-checked", "true");

  // 2. The journal says who, when and what
  // A HeroUI table row is named by its row header (the time), so find it by its text
  const entry = page.getByRole("row").filter({ hasText: reason });
  await expect(entry).toContainText("Новая основная");
  await expect(entry).toContainText("вместо NURSE-04");
  await expect(entry).toContainText("Madina Tulegenova");
  await expect(entry).toContainText("Gulnara Akhmetova");

  // 3. The next alert of ward 104 goes to the new primary nurse
  const description = `E2E ${Date.now()}: вызов после смены назначения`;
  await page.getByRole("button", { name: "Выйти" }).click();
  await signIn(page, NURSE_4);
  await openSection(page, "Симулятор устройств");
  await chooseOption(page, "Палата", WARD);
  await page.getByRole("radio", { name: /Кнопка вызова/ }).click();
  await page.getByRole("radio", { name: /HIGH/ }).click();
  await page.getByLabel("Описание (необязательно)").fill(description);
  await page.getByRole("button", { name: "Создать оповещение" }).click();
  await expect(page.getByRole("status")).toContainText("создано, назначено: NURSE-03");

  // 4. ...and shows on her post as hers to acknowledge
  await page.getByRole("button", { name: "Выйти" }).click();
  await signIn(page, NURSE_3);
  await openSection(page, "Пост медсестры");
  const card = page.locator("article", { hasText: description });
  await expect(card).toContainText("Назначено: Madina Tulegenova");
  await card.getByRole("button", { name: "Подтвердить" }).click();
  await expect(card.getByRole("button", { name: "Подтвердить" })).toHaveCount(0);
});
