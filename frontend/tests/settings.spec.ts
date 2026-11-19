import { test, expect } from "@playwright/test";

test("sections default closed, toggle independently by keyboard and retain only presentation state", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "sonari.training.v1",
      JSON.stringify({ mode: "custom", expanded: false }),
    ),
  );
  await page.goto("/");
  const open = page
    .getByRole("button", { name: "Настройки", exact: true })
    .first();
  await open.click();
  const headers = page.locator(".section-trigger");
  await expect(headers).toHaveCount(6);
  for (const header of await headers.all()) {
    await expect(header).toHaveAttribute("aria-expanded", "false");
    const id = await header.getAttribute("aria-controls");
    await expect(page.locator(`[id="${id}"]`)).toBeHidden();
  }
  const sound = page.getByRole("button", { name: "Звук", exact: true });
  const display = page.getByRole("button", {
    name: "Отображение",
    exact: true,
  });
  const before = await page.evaluate(() => ({
    settings: localStorage.getItem("sonari.settings.v2"),
    training: localStorage.getItem("sonari.training.v1"),
    audio: localStorage.getItem("sonari.audio.v1"),
    note: document.querySelector(".staff svg")?.getAttribute("data-midi"),
  }));
  await sound.focus();
  await page.keyboard.press("Tab");
  await expect(display).toBeFocused();
  await page.keyboard.press("Enter");
  await sound.focus();
  await page.keyboard.press("Space");
  await expect(display).toHaveAttribute("aria-expanded", "true");
  await expect(sound).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("slider", { name: "Громкость" }).fill("40");
  await sound.click();
  await sound.click();
  await expect(page.getByRole("slider", { name: "Громкость" })).toHaveValue(
    "40",
  );
  await page
    .getByRole("button", { name: "Закрыть настройки", exact: true })
    .click();
  await open.click();
  await expect(sound).toHaveAttribute("aria-expanded", "true");
  await page.reload();
  await open.click();
  await expect(display).toHaveAttribute("aria-expanded", "true");
  await expect(sound).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByRole("button", { name: "Диапазон", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  const after = await page.evaluate(() => ({
    settings: localStorage.getItem("sonari.settings.v2"),
    training: localStorage.getItem("sonari.training.v1"),
  }));
  expect(after).toEqual({
    settings: before.settings,
    training: before.training,
  });
  for (const header of await headers.all()) {
    if ((await header.getAttribute("aria-expanded")) === "false")
      await header.click();
    await expect(header).toHaveAttribute("aria-expanded", "true");
    await header.click();
    await expect(header).toHaveAttribute("aria-expanded", "false");
  }
});

test("malformed, old and partial section state recover without changing preferences", async ({
  page,
}) => {
  await page.goto("/");
  for (const value of [
    "{broken",
    "null",
    JSON.stringify({ version: 0, expanded: { sound: true } }),
    JSON.stringify({
      version: 1,
      expanded: { sound: true, display: "true", unknown: true },
    }),
  ]) {
    await page.evaluate(
      (value) => localStorage.setItem("sonari.settings.sections.v1", value),
      value,
    );
    await page.reload();
    await page
      .getByRole("button", { name: "Настройки", exact: true })
      .first()
      .click();
    const partial = value.includes('"version":1');
    await expect(
      page.getByRole("button", { name: "Звук", exact: true }),
    ).toHaveAttribute("aria-expanded", String(partial));
    await expect(
      page.getByRole("button", { name: "Отображение", exact: true }),
    ).toHaveAttribute("aria-expanded", "false");
  }
});

test("compact panel scrolls beneath fixed heading, exposes license and fits all sizes", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "sonari.training.v1",
      JSON.stringify({ mode: "custom", expanded: false }),
    ),
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Настройки", exact: true })
    .first()
    .click();
  for (const header of await page.locator(".section-trigger").all())
    await header.click();
  for (const [width, height] of [
    [760, 560],
    [900, 600],
    [1600, 1000],
  ]) {
    await page.setViewportSize({ width, height });
    await page.locator(".settings-scroll").evaluate((el) => (el.scrollTop = 0));
    await page.getByText("Об используемом звуке", { exact: true }).click();
    await expect(
      page.getByText("Salamander Grand Piano · Alexander Holm · CC BY 3.0", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Источник сэмплов" }),
    ).toHaveAttribute(
      "href",
      "https://github.com/Tonejs/audio/tree/master/salamander",
    );
    const heading = await page.locator(".aside-heading").boundingBox();
    await page.locator(".settings-scroll").hover();
    await page.mouse.wheel(0, 1500);
    await expect(
      page.getByRole("combobox", { name: "Заданий", exact: true }),
    ).toBeInViewport();
    expect(await page.locator(".aside-heading").boundingBox()).toEqual(heading);
    await expect(
      page.getByRole("button", { name: "Закрыть настройки", exact: true }),
    ).toBeInViewport();
    const scroll = await page.locator(".settings-scroll").boundingBox();
    expect(scroll!.y).toBeGreaterThanOrEqual(heading!.y + heading!.height);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.locator(".settings-scroll").evaluate((el) => (el.scrollTop = 0));
    await page.getByText("Об используемом звуке", { exact: true }).click();
  }
});
