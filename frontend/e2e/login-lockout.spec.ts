import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test("the fifth rejected login shows the lockout warning immediately", async ({ page }) => {
  await page.goto("/");
  // A fresh unknown badge makes retries independent of previous test runs.
  await page.getByLabel("Бейдж", { exact: true }).fill(`TEST-${randomUUID().slice(0, 23)}`);
  const alert = page.getByRole("alert");

  for (let attempt = 1; attempt <= 5; attempt++) {
    await page.getByLabel("PIN", { exact: true }).fill("0000");
    const responsePromise = page.waitForResponse((response) =>
      response.url().endsWith("/api/auth/login") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    const response = await responsePromise;
    if (attempt < 5) {
      expect(response.status()).toBe(401);
      await expect(alert).toHaveText("Вы ввели логин или пароль неправильно. Повторите попытку.");
    } else {
      expect(response.status()).toBe(429);
      expect(response.headers()["retry-after"]).toBe("300");
      await expect(alert).toContainText("Вход временно заблокирован");
      await expect(alert).toContainText("У вас 5 неудачных попыток входа! Повторите попытку через 5 минут.");
    }
    await expect(page.getByLabel("PIN", { exact: true })).toHaveValue("");
  }
});
