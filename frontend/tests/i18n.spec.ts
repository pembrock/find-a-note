import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";

for (const [locale, language, settings] of [
  ["ru-RU", "ru", "Настройки"],
  ["en-US", "en", "Settings"],
  ["fr-FR", "en", "Settings"],
] as const) {
  test.describe(locale, () => {
    test.use({ locale });
    test("uses local WebView language without persisting an automatic choice", async ({
      page,
    }) => {
      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute("lang", language);
      await expect(page.getByTitle(settings, { exact: true })).toBeVisible();
      expect(
        await page.evaluate(() => localStorage.getItem("sonari.language.v1")),
      ).toBeNull();
    });
  });
}

test("manual selection keeps the current exercise and preferences and survives reload", async ({
  page,
}) => {
  await page.goto("/");
  const note = page.locator(".staff svg");
  const current = await note.getAttribute("data-midi");
  await page
    .locator(`.piano button.white-key:not([data-midi="${current}"])`)
    .first()
    .click();
  await expect(page.locator(".errors")).toHaveText("Ошибки: 1");
  await page.getByTitle("Настройки", { exact: true }).click();
  await page.getByRole("button", { name: "Общие", exact: true }).click();
  const preferences = () =>
    page.evaluate(() =>
      Object.fromEntries(
        Object.entries(localStorage).filter(
          ([key]) => key.startsWith("sonari.") && key !== "sonari.language.v1",
        ),
      ),
    );
  const before = await preferences();
  await page
    .getByRole("combobox", { name: "Язык приложения" })
    .selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("combobox", { name: "Language" })).toHaveValue(
    "en",
  );
  await expect(note).toHaveAttribute("data-midi", current!);
  await expect(page.locator(".errors")).toHaveText("Errors: 1");
  expect(await preferences()).toEqual(before);
  await page.reload();
  await expect(page.getByTitle("Settings", { exact: true })).toBeVisible();
  expect(await preferences()).toEqual(before);
});

for (const language of ["ru", "en"] as const) {
  for (const [width, height] of [
    [760, 560],
    [900, 600],
    [1920, 1032],
  ]) {
    test(`${language} settings fit at ${width}×${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.addInitScript(
        (value) => localStorage.setItem("sonari.language.v1", value),
        language,
      );
      await page.goto("/");
      // MAC-03: font metrics in WebKit must not wrap the training value.
      const training = page.locator(".training-controls .select-trigger");
      expect(
        await training.evaluate((node) => {
          const text = node.firstElementChild!;
          const range = document.createRange();
          range.selectNodeContents(text);
          return range.getClientRects().length;
        }),
      ).toBe(1);
      expect(
        await training.evaluate((node) => node.scrollWidth <= node.clientWidth),
      ).toBe(true);
      const settings = language === "ru" ? "Настройки" : "Settings";
      await page.getByTitle(settings, { exact: true }).click();
      await page
        .getByRole("button", {
          name: language === "ru" ? "Общие" : "General",
          exact: true,
        })
        .click();
      await expect(
        page.getByRole("combobox", {
          name: language === "ru" ? "Язык приложения" : "Language",
        }),
      ).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      expect(
        await page
          .locator(".select-trigger:visible")
          .evaluateAll((nodes) =>
            nodes.every((node) => node.scrollWidth <= node.clientWidth + 1),
          ),
      ).toBe(true);
      await mkdir("../artifacts/i18n-01-screenshots", { recursive: true });
      await page.screenshot({
        path: `../artifacts/i18n-01-screenshots/${language}-${width}x${height}.png`,
        animations: "disabled",
      });
    });
  }
}
