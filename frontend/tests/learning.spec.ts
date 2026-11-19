import { test, expect } from "@playwright/test";
import { rememberExpandedSettings } from "./settings-fixture";
test.beforeEach(async ({ page }) => { await rememberExpandedSettings(page); });
import { learningPool, trainingNote, trainingSettings } from "../src/learning";
import { defaults } from "../src/model";

test("fixed learning pools and custom settings remain independent", () => {
  for (const expanded of [false, true]) {
    const training = { mode: "first" as const, expanded };
    const notes = learningPool(expanded);
    expect(notes).toEqual(
      expanded ? [60, 62, 64, 65, 67, 69, 71] : [60, 62, 64, 65, 67],
    );
    for (const previous of notes)
      for (let i = 0; i < 100; i++) {
        const note = trainingNote(
          { ...defaults, rangeMode: "full", chromatic: true },
          training,
          previous,
          () => i / 100,
        );
        expect(notes).toContain(note);
        expect(note).not.toBe(previous);
      }
    expect(
      trainingSettings({ ...defaults, clef: "bass", exact: false }, training),
    ).toMatchObject({ clef: "treble", exact: true });
  }
});

test("first launch, expansion, persistence, reveal, switching and compact layout", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Math.random = () => 0;
  });
  await page.setViewportSize({ width: 760, height: 560 });
  await page.goto("/");
  const mode = page.getByRole("combobox", { name: "Тренировка", exact: true });
  await expect(mode).toHaveText("Первые ноты · 5 нот");
  const svg = page.locator(".staff svg");
  await expect(svg).toHaveAttribute("data-midi", "60");
  await expect(svg).toHaveAttribute("data-clef", "treble");
  await page
    .getByRole("button", { name: "Настройки", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("combobox", { name: "Ключ", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("switch", { name: "Буквенное обозначение" }).click();
  await page.getByRole("switch", { name: "Русское название" }).click();
  await expect(page.locator(".note-names span")).toHaveCount(0);
  await page.locator('.white-key[data-midi="62"]').click();
  await expect(page.locator(".note-names span")).toHaveCount(0);
  await page.locator('.white-key[data-midi="60"]').dblclick();
  await expect(page.locator(".letter")).toHaveText("C4");
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "1",
  );
  await page
    .getByRole("button", { name: "+ Добавить ноты", exact: true })
    .click();
  await expect(mode).toHaveText("Первые ноты · 7 нот");
  await expect(page.locator(".note-names span")).toHaveCount(0);
  await expect(svg).toHaveAttribute("data-midi", "62");
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "0",
  );
  await page.waitForTimeout(1300);
  await expect(svg).toHaveAttribute("data-midi", "62");
  await page.reload();
  await expect(mode).toHaveText("Первые ноты · 7 нот");
  await page
    .getByRole("button", { name: "Начать с пяти нот", exact: true })
    .click();
  await expect(mode).toHaveText("Первые ноты · 5 нот");
  await mode.click();
  await page
    .getByRole("option", { name: "Своя тренировка", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Настройки", exact: true })
    .first()
    .click();
  await page.getByRole("combobox", { name: "Ключ", exact: true }).click();
  await page.getByRole("option", { name: "Басовый", exact: true }).click();
  const stored = await page.evaluate(() =>
    localStorage.getItem("sonari.settings.v2"),
  );
  await mode.click();
  await page
    .getByRole("option", { name: "Первые ноты · 5 нот", exact: true })
    .click();
  await expect(svg).toHaveAttribute("data-clef", "treble");
  expect(
    await page.evaluate(() => localStorage.getItem("sonari.settings.v2")),
  ).toBe(stored);
  for (const size of [
    { width: 760, height: 560 },
    { width: 900, height: 600 },
    { width: 1920, height: 1032 },
  ]) {
    await page.setViewportSize(size);
    const header = await page.locator("header").boundingBox();
    const controls = await page.locator(".training-controls").boundingBox();
    const actions = await page.locator(".window-actions").boundingBox();
    expect(controls!.x + controls!.width).toBeLessThanOrEqual(actions!.x + 1);
    expect(controls!.height).toBeLessThanOrEqual(header!.height);
    const main = await page.locator("main").boundingBox();
    const piano = await page.locator(".piano-panel").boundingBox();
    expect(main!.y + main!.height).toBeLessThanOrEqual(piano!.y + 1);
  }
  await mode.click();
  await page
    .getByRole("option", { name: "Своя тренировка", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Ключ", exact: true }),
  ).toHaveText("Басовый");
  await page.reload();
  await expect(mode).toHaveText("Своя тренировка");
  expect(
    await page.evaluate(() => localStorage.getItem("sonari.settings.v2")),
  ).toBe(stored);
});
