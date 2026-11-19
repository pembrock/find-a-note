import { test, expect } from "@playwright/test";
import { rememberExpandedSettings } from "./settings-fixture";
test.beforeEach(async ({ page }) => { await rememberExpandedSettings(page); });

test("assistance toolbar and octave caption fit all supported window sizes", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Подсветка клавиш", exact: true })
    .click();
  for (const size of [
    { width: 760, height: 560 },
    { width: 900, height: 600 },
    { width: 1920, height: 1032 },
  ]) {
    await page.setViewportSize(size);
    for (const settings of [false, true]) {
      if (settings)
        await page
          .getByRole("button", { name: "Настройки", exact: true })
          .first()
          .click();
      const heading = await page.locator(".piano-heading").boundingBox();
      const range = await page.locator(".octaves").boundingBox();
      expect(heading!.x + heading!.width).toBeLessThanOrEqual(range!.x);
      const name = await page.locator(".russian").boundingBox();
      const octave = await page.locator(".octave-name").boundingBox();
      const feedback = await page.locator(".feedback-space").boundingBox();
      expect(octave!.y).toBeGreaterThanOrEqual(name!.y + name!.height - 1);
      expect(octave!.y + octave!.height).toBeLessThanOrEqual(feedback!.y + 1);
      if (settings)
        await page
          .getByRole("button", { name: "Закрыть настройки", exact: true })
          .click();
    }
  }
});

test("independent persisted hints, concrete answer colours and optional octave labels", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Math.random = () => 0;
  });
  await page.goto("/");
  await page.clock.install();
  const hint = page.getByRole("button", {
    name: "Подсветка клавиш",
    exact: true,
  });
  const labels = page.getByRole("button", {
    name: "Подписи клавиш",
    exact: true,
  });
  const target = page.locator('.piano [data-midi="60"]');
  await expect(hint).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".hinted")).toHaveCount(0);
  await expect(page.locator(".octave-name")).toHaveText("Первая октава");
  const settings = await page.evaluate(() =>
    localStorage.getItem("sonari.settings.v2"),
  );
  await hint.click();
  await expect(target).toHaveClass(/hinted/);
  await expect(target).not.toHaveClass(/pressed/);
  await labels.click();
  await expect(page.locator(".piano button span")).toHaveCount(0);
  await expect(target).toHaveClass(/hinted/);
  expect(
    await page.evaluate(() => localStorage.getItem("sonari.settings.v2")),
  ).toBe(settings);
  await page.reload();
  await expect(hint).toHaveAttribute("aria-pressed", "true");
  await expect(labels).toHaveAttribute("aria-pressed", "false");
  await page
    .getByRole("button", { name: "Настройки", exact: true })
    .first()
    .click();
  await page
    .getByRole("switch", { name: "Русское название", exact: true })
    .click();
  await page
    .getByRole("switch", { name: "Буквенное обозначение", exact: true })
    .click();
  await expect(page.locator(".octave-name")).toHaveCount(0);
  await hint.click();
  const wrong = page.locator('.piano [data-midi="61"]');
  await wrong.click();
  await expect(wrong).toHaveClass(/answer-wrong/);
  await expect(page.locator(".hinted")).toHaveCount(0);
  await expect(page.locator(".note-names")).toBeEmpty();
  await page.clock.runFor(701);
  await expect(wrong).not.toHaveClass(/answer-wrong/);
  await hint.click();
  await wrong.click();
  await expect(target).toHaveClass(/hinted/);
  await expect(wrong).toHaveClass(/answer-wrong/);
  await target.dblclick();
  await expect(target).toHaveClass(/answer-correct/);
  expect(
    await target.evaluate((el) => getComputedStyle(el).backgroundImage),
  ).toContain("100, 185, 139");
  await expect(wrong).not.toHaveClass(/answer-wrong/);
  await expect(page.locator(".octave-name")).toHaveText("Первая октава");
  await expect(page.locator(".feedback")).toHaveText("Верно!");
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "1",
  );
  await page.clock.runFor(750);
  await expect(target).toHaveClass(/answer-correct/);
  await page.clock.runFor(451);
  await expect(page.locator(".answer-correct")).toHaveCount(0);
  await expect(page.locator(".hinted")).toHaveAttribute("data-midi", "62");
  await expect(page.locator(".octave-name")).toHaveCount(0);
  await page
    .getByRole("switch", { name: "Название октавы", exact: true })
    .click();
  await page.locator('.piano [data-midi="62"]').click();
  await expect(page.locator(".russian")).toHaveText("Ре");
  await expect(page.locator(".octave-name")).toHaveCount(0);
  await page.reload();
  await page
    .getByRole("button", { name: "Настройки", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("switch", { name: "Название октавы", exact: true }),
  ).toHaveAttribute("aria-checked", "false");
});

test("black key hints, answer priority and any-octave feedback refer to the played MIDI note", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Math.random = () => 0.27;
    localStorage.setItem(
      "sonari.training.v1",
      JSON.stringify({ mode: "custom" }),
    );
    localStorage.setItem(
      "sonari.settings.v2",
      JSON.stringify({
        version: 2,
        octaves: [4],
        chromatic: true,
        exact: false,
      }),
    );
  });
  await page.goto("/");
  await page.clock.install();
  await page
    .getByRole("button", { name: "Подсветка клавиш", exact: true })
    .click();
  const target = page.locator('.black-key[data-midi="63"]');
  await expect(target).toHaveClass(/hinted/);
  await expect(page.locator(".hinted")).toHaveCount(1);
  const background = await target.evaluate(
    (el) => getComputedStyle(el).backgroundImage,
  );
  const played = page.locator('.black-key[data-midi="75"]');
  await played.click();
  await expect(played).toHaveClass(/answer-correct/);
  await expect(target).not.toHaveClass(/answer-correct/);
  await expect(target).toHaveClass(/hinted/);
  expect(
    await played.evaluate((el) => getComputedStyle(el).backgroundImage),
  ).not.toBe(background);
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "1",
  );
  await played.click();
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "1",
  );
  await page.clock.runFor(651);
  await expect(page.locator(".answer-correct")).toHaveCount(0);
});

test("automatic viewport is stable, follows the next task atomically and respects instrument edges", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Math.random = () => 0;
    localStorage.setItem(
      "sonari.training.v1",
      JSON.stringify({ mode: "custom" }),
    );
    if (!localStorage.getItem("sonari.settings.v2"))
      localStorage.setItem(
        "sonari.settings.v2",
        JSON.stringify({ version: 2, octaves: [2, 4, 6], count: 0 }),
      );
  });
  await page.goto("/");
  await page.clock.install();
  const stored = await page.evaluate(() =>
    localStorage.getItem("sonari.settings.v2"),
  );
  const svg = page.locator(".staff svg");
  await expect(svg).toHaveAttribute("data-midi", "36");
  await expect(page.locator(".octaves")).toHaveText("C2–B3");
  await expect(page.getByRole("button", { name: /Октавой/ })).toHaveCount(0);
  await page.evaluate(() => {
    Math.random = () => 0.999;
  });
  await page.locator('.piano [data-midi="36"]').click();
  await expect(page.locator(".octaves")).toHaveText("C2–B3");
  await page
    .getByRole("button", { name: "Виртуальное пианино", exact: true })
    .click();
  await page.clock.runFor(651);
  await expect(svg).toHaveAttribute("data-midi", "95");
  await page
    .getByRole("button", { name: "Виртуальное пианино", exact: true })
    .click();
  await expect(page.locator(".octaves")).toHaveText("C5–B6");
  await expect(page.locator('.piano [data-midi="95"]')).toBeVisible();
  await expect(page.locator(".octave-name")).toHaveText("Третья октава");
  expect(
    await page.evaluate(() => localStorage.getItem("sonari.settings.v2")),
  ).toBe(stored);
  for (const [oct, midi, range, name] of [
    [0, 21, "A0–B1", "Субконтроктава"],
    [8, 108, "C7–C8", "Пятая октава"],
  ] as const) {
    await page.evaluate(
      ({ oct }) => {
        localStorage.setItem(
          "sonari.settings.v2",
          JSON.stringify({ version: 2, octaves: [oct] }),
        );
      },
      { oct },
    );
    await page.reload();
    await expect(svg).toHaveAttribute("data-midi", String(midi));
    await expect(page.locator(".octaves")).toHaveText(range);
    await expect(page.locator(".octave-name")).toHaveText(name);
    await expect(page.locator(`.piano [data-midi="${midi}"]`)).toBeVisible();
    const pitches = await page
      .locator(".piano button")
      .evaluateAll((keys) =>
        keys.map((el) => Number(el.getAttribute("data-midi"))),
      );
    expect(pitches.every((note) => note >= 21 && note <= 108)).toBe(true);
  }
});
