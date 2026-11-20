import { test, expect } from "@playwright/test";
import { rememberExpandedSettings } from "./settings-fixture";
test.beforeEach(async ({ page }) => { await rememberExpandedSettings(page); });
import { pool, normalize, describe } from "../src/model";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "sonari.training.v1",
      JSON.stringify({ mode: "custom", expanded: false }),
    ),
  );
});

test("keyboard label toggle persists independently and never reveals hidden labels on hover", async ({
  page,
}) => {
  await page.setViewportSize({ width: 760, height: 560 });
  await page.addInitScript(() => {
    Math.random = () => 0.27;
    localStorage.setItem(
      "sonari.settings.v2",
      JSON.stringify({ version: 2, octaves: [4], chromatic: true, count: 10 }),
    );
  });
  await page.goto("/");
  const toggle = page.getByRole("button", {
    name: "Подписи клавиш",
    exact: true,
  });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".white-key span")).toHaveCount(14);
  const midi = await page.locator(".staff svg").getAttribute("data-midi");
  const pitches = await page
    .locator(".piano button")
    .evaluateAll((keys) => keys.map((el) => el.getAttribute("data-midi")));
  const settings = await page.evaluate(() =>
    localStorage.getItem("sonari.settings.v2"),
  );
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".piano button span")).toHaveCount(0);
  await page.locator(".white-key").first().hover();
  await page.locator(".black-key").first().hover();
  await page.locator(".black-key").first().focus();
  await expect(page.locator(".piano button span")).toHaveCount(0);
  await expect(page.locator(".piano button[title]")).toHaveCount(0);
  await expect(page.locator(".staff svg")).toHaveAttribute("data-midi", midi!);
  expect(
    await page.evaluate(() => localStorage.getItem("sonari.settings.v2")),
  ).toBe(settings);
  expect(
    await page
      .locator(".piano button")
      .evaluateAll((keys) => keys.map((el) => el.getAttribute("data-midi"))),
  ).toEqual(pitches);
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".piano button span")).toHaveCount(0);
  await page.locator('.black-key[data-midi="63"]').click();
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "1",
  );
  await page
    .getByRole("button", { name: "Виртуальное пианино", exact: true })
    .click();
  await expect(page.locator(".piano")).toHaveCount(0);
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: "Виртуальное пианино", exact: true })
    .click();
  await expect(page.locator(".white-key span")).toHaveCount(14);
  const toolbar = await page.locator(".piano-toolbar").boundingBox(),
    control = await toggle.boundingBox();
  expect(control!.x + control!.width).toBeLessThanOrEqual(
    toolbar!.x + toolbar!.width,
  );
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  for (const invalid of ["null", '"false"', "{broken"]) {
    await page.evaluate(
      (value) => localStorage.setItem("sonari.keyboard.labels.v1", value),
      invalid,
    );
    await page.reload();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
  }
});

test("migration, disjoint octaves, styled menus and keyboard dismissal", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "sonari.settings.v1",
      JSON.stringify({ min: 48, max: 83, exact: false }),
    ),
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Настройки", exact: true })
    .first()
    .click();
  const octaves = page.getByRole("group", { name: "Октавы заданий" });
  await expect(octaves.getByRole("button", { pressed: true })).toHaveCount(3);
  await octaves.getByRole("button", { name: "C3–B3", exact: true }).click();
  await octaves.getByRole("button", { name: "C2–B2", exact: true }).click();
  const saved = JSON.parse(
    (await page.evaluate(() => localStorage.getItem("sonari.settings.v2")))!,
  );
  expect(saved.octaves).toEqual([2, 4, 5]);
  expect(
    pool(normalize(saved)).every((m) =>
      [2, 4, 5].includes(Math.floor(m / 12) - 1),
    ),
  ).toBeTruthy();
  await page.reload();
  await page
    .getByRole("button", { name: "Настройки", exact: true })
    .first()
    .click();
  await expect(
    page
      .getByRole("group", { name: "Октавы заданий" })
      .getByRole("button", { pressed: true }),
  ).toHaveCount(3);
  const select = page.getByRole("combobox", { name: "Клавиши", exact: true });
  await select.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("listbox")).toBeVisible();
  await expect(
    page.getByRole("option", { name: "Только белые", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("End");
  await expect(
    page.getByRole("option", { name: "Все клавиши", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(select).toHaveText("Все клавиши");
  await page.getByRole("combobox", { name: "Альтерации", exact: true }).click();
  await page.getByRole("option", { name: "Бемоли ♭", exact: true }).click();
  await select.click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(select).toBeFocused();
  await select.click();
  // Radix mounts its dismissable layer and moves focus asynchronously.
  await expect(
    page.getByRole("option", { name: "Все клавиши", exact: true }),
  ).toBeFocused();
  // The modal makes body descendants inert. Click the actual hit-test target
  // at the brand position, allowing Playwright's normal stability checks.
  const brand = (await page.locator(".brand").boundingBox())!;
  await page.locator("html").click({
    position: { x: brand.x + brand.width / 2, y: brand.y + brand.height / 2 },
  });
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Вся клавиатура", exact: true })
    .click();
  const full = JSON.parse(
    (await page.evaluate(() => localStorage.getItem("sonari.settings.v2")))!,
  );
  expect(pool(normalize(full))).toHaveLength(88);
});

test("answer locking, errors, complete series, reset and infinite progress", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "sonari.settings.v2",
      JSON.stringify({ version: 2, octaves: [4], count: 10 }),
    ),
  );
  await page.goto("/");
  let midi = Number(await page.locator(".staff svg").getAttribute("data-midi"));
  await page
    .locator(`[data-midi="${midi === 60 ? 62 : 60}"].white-key`)
    .click();
  await expect(page.locator(".errors")).toHaveText("Ошибки: 1");
  await expect(page.locator(".staff svg")).toHaveAttribute(
    "data-midi",
    String(midi),
  );
  await page.locator(`[data-midi="${midi}"].white-key`).dblclick({ delay: 25 });
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "1",
  );
  await expect(page.locator(".staff svg")).not.toHaveAttribute(
    "data-midi",
    String(midi),
  );
  for (let i = 1; i < 10; i++) {
    midi = Number(await page.locator(".staff svg").getAttribute("data-midi"));
    await page.locator(`[data-midi="${midi}"].white-key`).click();
    if (i < 9)
      await expect(page.locator(".staff svg")).not.toHaveAttribute(
        "data-midi",
        String(midi),
      );
  }
  await expect(
    page.getByRole("heading", { name: "Отличная работа!" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Ещё раз" }).click();
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "0",
  );
  await page
    .getByRole("button", { name: "Настройки", exact: true })
    .first()
    .click();
  await page.getByRole("combobox", { name: "Заданий", exact: true }).click();
  await page.getByRole("option", { name: "Бесконечно", exact: true }).click();
  await expect(page.getByRole("progressbar")).toHaveCount(0);
});

test("responsive layout and musical SVGs in both clefs and extreme registers", async ({
  page,
}) => {
  for (const viewport of [
    { width: 900, height: 600 },
    { width: 760, height: 560 },
    { width: 1400, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    for (const open of [false, true]) {
      if (open)
        await page
          .getByRole("button", { name: "Настройки", exact: true })
          .first()
          .click();
      const main = await page.locator("main").boundingBox(),
        piano = await page.locator(".piano-panel").boundingBox(),
        footer = await page.locator("footer").boundingBox();
      expect(main!.y + main!.height).toBeLessThanOrEqual(piano!.y + 1);
      expect(piano!.y + piano!.height).toBeLessThanOrEqual(footer!.y + 1);
      expect(footer!.y + footer!.height).toBeLessThanOrEqual(
        viewport.height + 1,
      );
      await expect(page.locator(".staff svg")).toBeVisible();
      await page
        .getByRole("button", { name: "Виртуальное пианино", exact: true })
        .click();
      await expect(page.locator(".piano")).toHaveCount(0);
      await page
        .getByRole("button", { name: "Виртуальное пианино", exact: true })
        .click();
    }
  }
  for (const clef of ["treble", "bass", "auto"])
    for (const oct of [0, 4, 8]) {
      await page.evaluate(
        ({ clef, oct }) =>
          localStorage.setItem(
            "sonari.settings.v2",
            JSON.stringify({
              version: 2,
              octaves: [oct],
              clef,
              chromatic: true,
              spelling: "flat",
            }),
          ),
        { clef, oct },
      );
      await page.reload();
      const svg = page.locator(".staff svg");
      await expect(svg).toBeVisible();
      const midi = Number(await svg.getAttribute("data-midi"));
      await expect(page.locator(".letter")).toHaveText(
        describe(midi, "flat").letter.replace("b", "♭"),
      );
      expect(await svg.locator("path").count()).toBeGreaterThan(2);
      await expect(svg).toHaveAttribute("data-written-midi", String(midi));
      await expect(svg.locator(".vf-annotation")).toHaveCount(0);
      // A resize redraw can replace the SVG between locator resolution and
      // evaluation. Find and measure the current SVG in one browser callback.
      const bounds = await page.locator(".staff").evaluate((staff) => {
        const score = staff.querySelector("svg")!;
        const box = score.getBBox();
        const viewBox = score.viewBox.baseVal;
        return {
          height: box.height,
          top: box.y,
          bottom: box.y + box.height,
          viewTop: viewBox.y,
          viewBottom: viewBox.y + viewBox.height,
        };
      });
      const context = `clef=${clef}, octave=${oct}, MIDI=${midi}`;
      expect(bounds.height, context).toBeGreaterThan(0);
      expect(bounds.top, context).toBeGreaterThanOrEqual(bounds.viewTop);
      expect(bounds.bottom, context).toBeLessThanOrEqual(bounds.viewBottom);
    }
});

test("D5 in bass and A0/C8 in forced clefs never transpose or clip", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Math.random = () => 0.2;
  });
  await page.goto("/");
  for (const viewport of [
    { width: 900, height: 600 },
    { width: 760, height: 560 },
  ]) {
    await page.setViewportSize(viewport);
    for (const [oct, expected] of [
      [5, 74],
      [0, 21],
      [8, 108],
    ])
      for (const clef of ["bass", "treble", "auto"])
        for (const spelling of ["sharp", "flat"]) {
          await page.evaluate(
            ({ oct, clef, spelling }) =>
              localStorage.setItem(
                "sonari.settings.v2",
                JSON.stringify({
                  version: 2,
                  octaves: [oct],
                  clef,
                  spelling,
                  chromatic: true,
                }),
              ),
            { oct, clef, spelling },
          );
          await page.reload();
          const svg = page.locator(".staff svg");
          await expect(svg).toHaveAttribute("data-midi", String(expected));
          await expect(svg).toHaveAttribute(
            "data-written-midi",
            String(expected),
          );
          await expect(svg.locator(".vf-annotation")).toHaveCount(0);
          await expect(page.locator("main")).not.toContainText(
            /8va|8vb|15ma|15mb/,
          );
          const geometry = await page.locator(".staff").evaluate((staff) => {
            const score = staff.querySelector("svg")!;
            const box = score.getBBox();
            const viewBox = score.viewBox.baseVal;
            return {
              box: { x: box.x, y: box.y, width: box.width, height: box.height },
              viewBox: {
                x: viewBox.x,
                y: viewBox.y,
                width: viewBox.width,
                height: viewBox.height,
              },
              paths: score.querySelectorAll("path").length,
            };
          });
          const { box, viewBox, paths } = geometry;
          const context = `clef=${clef}, spelling=${spelling}, MIDI=${expected}, viewport=${viewport.width}×${viewport.height}`;
          expect(box.width, context).toBeGreaterThan(0);
          expect(box.height, context).toBeGreaterThan(0);
          expect(box.x, context).toBeGreaterThanOrEqual(viewBox.x);
          expect(box.y, context).toBeGreaterThanOrEqual(viewBox.y);
          expect(box.x + box.width, context).toBeLessThanOrEqual(
            viewBox.x + viewBox.width,
          );
          expect(box.y + box.height, context).toBeLessThanOrEqual(
            viewBox.y + viewBox.height,
          );
          expect(paths, context).toBeGreaterThan(2);
          await page.locator(".note-names").scrollIntoViewIfNeeded();
          const names = await page.locator(".note-names").boundingBox(),
            piano = await page.locator(".piano-panel").boundingBox();
          expect(names!.y + names!.height).toBeLessThanOrEqual(piano!.y + 1);
        }
  }
});

test("hidden names reveal only on success, remain locked for 1200ms and reset", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Math.random = () => 0.27;
  });
  await page.goto("/");
  for (const spelling of ["sharp", "flat"] as const)
    for (const [letter, russian] of [
      [false, false],
      [true, false],
      [false, true],
      [true, true],
    ]) {
      await page.evaluate(
        ({ letter, russian, spelling }) =>
          localStorage.setItem(
            "sonari.settings.v2",
            JSON.stringify({
              version: 2,
              octaves: [4],
              chromatic: true,
              staff: true,
              letter,
              russian,
              spelling,
              count: 10,
            }),
          ),
        { letter, russian, spelling },
      );
      await page.reload();
      await expect(page.locator(".staff svg")).toHaveAttribute(
        "data-midi",
        "63",
      );
      await expect(page.locator(".letter")).toHaveCount(Number(letter));
      await expect(page.locator(".russian")).toHaveCount(Number(russian));
      await page.locator('.white-key[data-midi="60"]').click();
      await expect(page.locator(".errors")).toHaveText("Ошибки: 1");
      await expect(page.locator(".letter")).toHaveCount(Number(letter));
      await expect(page.locator(".russian")).toHaveCount(Number(russian));
      await page.locator('.black-key[data-midi="63"]').dblclick({ delay: 20 });
      await expect(page.locator(".feedback.correct")).toHaveText("Верно!");
      await expect(page.locator(".letter")).toHaveText(
        describe(63, spelling).letter.replace("#", "♯").replace("b", "♭"),
      );
      await expect(page.locator(".russian")).toHaveText(
        describe(63, spelling).russian,
      );
      await expect(page.getByRole("progressbar")).toHaveAttribute(
        "aria-valuenow",
        "1",
      );
      if (!letter || !russian) {
        await page.waitForTimeout(750);
        await expect(page.locator(".staff svg")).toHaveAttribute(
          "data-midi",
          "63",
        );
        await page.locator('.white-key[data-midi="60"]').click();
        await expect(page.locator(".errors")).toHaveText("Ошибки: 1");
      }
      await expect(page.locator(".staff svg")).not.toHaveAttribute(
        "data-midi",
        "63",
      );
      await expect(page.locator(".letter")).toHaveCount(Number(letter));
      await expect(page.locator(".russian")).toHaveCount(Number(russian));
    }
});

test("desktop text cannot be selected, editable fields retain selection and keyboard access", async ({
  page,
}) => {
  await page.goto("/");
  for (const selector of [
    ".brand",
    ".note-names",
    ".staff svg",
    ".white-key span",
    "footer",
  ]) {
    expect(
      await page
        .locator(selector)
        .first()
        .evaluate((el) => getComputedStyle(el).userSelect),
    ).toBe("none");
  }
  const box = (await page.locator(".note-names").boundingBox())!;
  await page.mouse.move(box.x + 3, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 3, box.y + box.height / 2, {
    steps: 12,
  });
  await page.mouse.up();
  expect(await page.evaluate(() => getSelection()?.toString())).toBe("");
  await page.evaluate(() => {
    for (const tag of ["input", "textarea", "div"]) {
      const el = document.createElement(tag);
      if (tag === "div") el.contentEditable = "true";
      el.id = "editable-" + tag;
      el.style.cssText =
        "position:fixed;left:30px;top:" +
        (80 + ["input", "textarea", "div"].indexOf(tag) * 55) +
        "px;z-index:100;background:#252536;padding:6px";
      document.body.appendChild(el);
    }
  });
  for (const tag of ["input", "textarea", "div"]) {
    const field = page.locator("#editable-" + tag);
    await field.fill("Editable sample");
    expect(await field.evaluate((el) => getComputedStyle(el).userSelect)).toBe(
      "text",
    );
    await field.press(process.platform === "darwin" ? "Meta+ArrowLeft" : "Home");
    await field.press(process.platform === "darwin" ? "Meta+Shift+ArrowRight" : "Shift+End");
    const selected = await field.evaluate((el) =>
      el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
        ? el.value.slice(el.selectionStart || 0, el.selectionEnd || 0)
        : getSelection()?.toString(),
    );
    expect(selected).toBe("Editable sample");
  }
  await page.evaluate(() =>
    document.querySelectorAll('[id^="editable-"]').forEach((el) => el.remove()),
  );
  await page
    .getByRole("button", { name: "Настройки", exact: true })
    .first()
    .click();
  const select = page.getByRole("combobox", { name: "Клавиши", exact: true });
  await select.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(select).toBeFocused();
  await page.evaluate(() =>
    localStorage.setItem(
      "sonari.settings.v2",
      JSON.stringify({
        version: 2,
        octaves: [8],
        staff: false,
        letter: true,
        russian: true,
      }),
    ),
  );
  await page.reload();
  await expect(page.locator(".staff svg")).toHaveCount(0);
  await expect(page.locator(".notation")).not.toHaveClass(/extended/);
});
