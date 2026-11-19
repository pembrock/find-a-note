import { test, expect, type Page } from "@playwright/test";
import { rememberExpandedSettings } from "./settings-fixture";
test.beforeEach(async ({ page }) => { await rememberExpandedSettings(page); });
async function setup(
  page: Page,
  options: {
    custom?: boolean;
    octaves?: number[];
    full?: boolean;
    duplicate?: boolean;
    profile?: [number, number];
  } = {},
) {
  await page.addInitScript((options) => {
    Math.random = () => 0;
    const devices = [
      { id: "a", identity: "a", name: "Test Piano A" },
      {
        id: "b",
        identity: options.duplicate ? "a" : "b",
        name: "Test Piano B",
      },
    ];
    let state: any = {
      devices,
      selected: devices[0],
      status: "connected",
      session: "1",
      revision: 1,
      message: "",
    };
    const listeners = new Map<string, Set<(data: any) => void>>();
    const emit = (name: string, data: any) =>
      listeners.get(name)?.forEach((fn) => fn(structuredClone(data)));
    const publish = () => {
      state.revision++;
      emit("midi:state", state);
      return structuredClone(state);
    };
    Object.assign(window, {
      runtime: {
        EventsOnMultiple: (name: string, fn: (data: any) => void) => {
          const set = listeners.get(name) ?? new Set();
          set.add(fn);
          listeners.set(name, set);
          return () => set.delete(fn);
        },
      },
      go: {
        main: {
          App: {
            GetMIDIState: async () => structuredClone(state),
            RefreshMIDIDevices: async () => publish(),
            ConnectMIDI: async (id: string) => {
              state = {
                ...state,
                status: "connected",
                selected: devices.find((d) => d.id === id),
                session: String(Number(state.session) + 1),
              };
              return publish();
            },
            DisconnectMIDI: async () => {
              state = {
                ...state,
                status: "virtual",
                selected: null,
                session: String(Number(state.session) + 1),
              };
              return publish();
            },
          },
        },
      },
      __calibration: {
        send: (
          note: number,
          velocity = 100,
          type = "noteon",
          session = state.session,
        ) => emit("midi:note", { note, velocity, type, session, channel: 1 }),
        disconnect: () => {
          state = {
            ...state,
            status: "error",
            session: String(Number(state.session) + 1),
          };
          publish();
        },
        reconnect: () => {
          state = {
            ...state,
            status: "connected",
            session: String(Number(state.session) + 1),
          };
          publish();
        },
        switch: (id: string) => {
          state = {
            ...state,
            status: "connected",
            selected: devices.find((d) => d.id === id),
            session: String(Number(state.session) + 1),
          };
          publish();
        },
      },
    });
    if (!localStorage.getItem("test.seeded")) {
      localStorage.setItem("test.seeded", "true");
      if (options.custom)
        localStorage.setItem(
          "sonari.training.v1",
          JSON.stringify({ mode: "custom" }),
        );
      localStorage.setItem(
        "sonari.settings.v2",
        JSON.stringify({
          version: 2,
          octaves: options.octaves ?? [4],
          rangeMode: options.full ? "full" : "octaves",
        }),
      );
      if (options.profile)
        localStorage.setItem(
          "sonari.midi.calibration.v1",
          JSON.stringify({
            version: 1,
            offered: ["a"],
            profiles: [
              {
                identity: "a",
                name: "Test Piano A",
                lowerMidiNote: options.profile[0],
                upperMidiNote: options.profile[1],
                confirmed: true,
              },
            ],
          }),
        );
    }
  }, options);
  await page.goto("/");
}
async function send(
  page: Page,
  note: number,
  velocity = 100,
  type = "noteon",
  session?: string,
) {
  await page.evaluate(
    ({ note, velocity, type, session }) =>
      (window as any).__calibration.send(note, velocity, type, session),
    { note, velocity, type, session },
  );
}
const wizard = (page: Page) =>
  page.getByRole("dialog", {
    name: /Настройка клавиатуры|Определи диапазон|Диапазон определён|Инструмент отключён/,
  });
async function openAgain(page: Page) {
  await page
    .getByRole("button", { name: "Устройство ввода", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Устройство ввода", exact: true })
    .getByRole("button", { name: /Определить (заново|диапазон)/ })
    .click();
  await wizard(page)
    .getByRole("button", { name: "Начать", exact: true })
    .click();
}
async function calibrate(page: Page, lower: number, upper: number) {
  await send(page, lower);
  await send(page, upper);
  await expect(wizard(page)).toHaveAccessibleName("Диапазон определён");
  await wizard(page)
    .getByRole("button", { name: "Сохранить", exact: true })
    .click();
}

test("language changes preserve the connected MIDI session and calibration boundary", async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 560 });
  await setup(page);
  await wizard(page).getByRole("button", { name: "Начать", exact: true }).click();
  await send(page, 21);
  await send(page, 20);
  await expect(wizard(page).getByRole("alert")).toContainText("выше левой");
  await wizard(page).getByRole("combobox", { name: "Язык приложения" }).selectOption("en");
  const dialog = page.getByRole("dialog", { name: "Calibrate your keyboard range" });
  await expect(dialog.getByRole("alert")).toContainText("higher than the left key");
  await expect(dialog.locator(".calibration-cards .complete h2")).toHaveText("A0");
  await send(page, 108);
  const result = page.getByRole("dialog", { name: "Range calibrated" });
  await expect(result).toContainText("88 notes");
  for (const [width, height] of [[760, 560], [900, 600], [1920, 1032]]) {
    await page.setViewportSize({ width, height });
    await expect(result.getByRole("button", { name: "Save", exact: true })).toBeInViewport();
  }
  await result.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Input device" })).toContainText("Test Piano A");
});

test("optional wizard routes only MIDI, validates boundaries and saves only explicit confirmation", async ({
  page,
}) => {
  await setup(page);
  await expect(wizard(page)).toBeVisible();
  const settings = await page.evaluate(() =>
    localStorage.getItem("sonari.settings.v2"),
  );
  const current = await page.locator(".staff svg").getAttribute("data-midi");
  await send(page, 60); // Preparation must not answer or capture a boundary.
  await wizard(page)
    .getByRole("button", { name: "Начать", exact: true })
    .click();
  await send(page, 21, 0);
  await send(page, 21, 100, "noteoff");
  await send(page, 21, 100, "noteon", "stale");
  await expect(page.locator(".calibration-cards .active h2")).toHaveText(
    "Нажмите крайнюю левую клавишу",
  );
  await send(page, 21);
  await expect(page.locator(".calibration-cards .complete h2")).toHaveText(
    "A0",
  );
  await send(page, 21);
  await expect(wizard(page).getByRole("alert")).toContainText("выше левой");
  await send(page, 20);
  await expect(wizard(page).getByRole("alert")).toBeVisible();
  await send(page, 108);
  await expect(page.locator(".calibration-result")).toHaveText("A0 — C8");
  await expect(wizard(page)).toContainText("88 нот");
  expect(
    JSON.parse(
      (await page.evaluate(() =>
        localStorage.getItem("sonari.midi.calibration.v1"),
      ))!,
    ).profiles,
  ).toEqual([]);
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "0",
  );
  await expect(page.locator(".errors")).toHaveText("Ошибки: 0");
  await expect(page.locator(".staff svg")).toHaveAttribute(
    "data-midi",
    current!,
  );
  await wizard(page)
    .getByRole("button", { name: "Сохранить", exact: true })
    .click();
  expect(
    JSON.parse(
      (await page.evaluate(() =>
        localStorage.getItem("sonari.midi.calibration.v1"),
      ))!,
    ).profiles[0],
  ).toMatchObject({ lowerMidiNote: 21, upperMidiNote: 108, confirmed: true });
  expect(
    await page.evaluate(() => localStorage.getItem("sonari.settings.v2")),
  ).toBe(settings);
  await page.reload();
  await expect(wizard(page)).toHaveCount(0);
  await openAgain(page);
  await send(page, 48);
  await send(page, 72);
  await wizard(page)
    .getByRole("button", { name: "Отмена", exact: true })
    .click();
  expect(
    JSON.parse(
      (await page.evaluate(() =>
        localStorage.getItem("sonari.midi.calibration.v1"),
      ))!,
    ).profiles[0].lowerMidiNote,
  ).toBe(21);
});

test("defer persists, interrupted wizard discards boundaries and new sessions restart safely", async ({
  page,
}) => {
  await setup(page);
  await wizard(page)
    .getByRole("button", { name: "Позже", exact: true })
    .click();
  await page.reload();
  await expect(wizard(page)).toHaveCount(0);
  await openAgain(page);
  await send(page, 21);
  await page.evaluate(() => (window as any).__calibration.disconnect());
  await expect(wizard(page)).toHaveAccessibleName("Инструмент отключён");
  await page.evaluate(() => (window as any).__calibration.reconnect());
  await send(page, 108, 100, "noteon", "1");
  await send(page, 108);
  await expect(wizard(page)).toHaveAccessibleName("Инструмент отключён");
  await wizard(page)
    .getByRole("button", { name: "Определить заново", exact: true })
    .click();
  await expect(page.locator(".calibration-cards .active h2")).toHaveText(
    "Нажмите крайнюю левую клавишу",
  );
  await calibrate(page, 36, 84);
  await page.evaluate(() => (window as any).__calibration.disconnect());
  await page.evaluate(() => (window as any).__calibration.reconnect());
  await expect(wizard(page)).toHaveCount(0);
});

test("calibrated ranges intersect disjoint octaves and virtual input restores full choices without rewriting preferences", async ({
  page,
}) => {
  await setup(page, { custom: true, octaves: [2, 4, 6] });
  await wizard(page)
    .getByRole("button", { name: "Начать", exact: true })
    .click();
  const settings = await page.evaluate(() =>
    localStorage.getItem("sonari.settings.v2"),
  );
  await calibrate(page, 55, 76); // G3-E5, only octave 4 intersects the selected octaves.
  for (let i = 0; i < 4; i++) {
    const note = Number(
      await page.locator(".staff svg").getAttribute("data-midi"),
    );
    expect(note).toBeGreaterThanOrEqual(60);
    expect(note).toBeLessThan(72);
    await send(page, note);
    await expect(page.locator(".staff svg")).not.toHaveAttribute(
      "data-midi",
      String(note),
    );
  }
  expect(
    await page.evaluate(() => localStorage.getItem("sonari.settings.v2")),
  ).toBe(settings);
  await page
    .getByRole("button", { name: "Настройки", exact: true })
    .first()
    .click();
  const octaves = page.getByRole("group", { name: "Октавы заданий" });
  await expect(octaves.getByRole("button")).toHaveCount(3);
  await expect(
    octaves.getByRole("button", { name: "G3–B3", exact: true }),
  ).toBeVisible();
  await expect(
    octaves.getByRole("button", { name: "C5–E5", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Устройство ввода", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Устройство ввода", exact: true })
    .getByRole("button", { name: "Виртуальная клавиатура", exact: false })
    .click();
  await expect(octaves.getByRole("button")).toHaveCount(9);
  expect(
    await page.evaluate(() => localStorage.getItem("sonari.settings.v2")),
  ).toBe(settings);
  await page.keyboard.press("Escape");
  await page.evaluate(() => (window as any).__calibration.switch("a"));
  await expect(octaves.getByRole("button")).toHaveCount(3);
});

test("incompatible first notes and empty custom ranges block tasks until an explicit choice", async ({
  page,
}) => {
  await setup(page, { profile: [36, 59] });
  await expect(
    page.getByRole("heading", { name: "Учебный набор недоступен" }),
  ).toBeVisible();
  await expect(page.locator(".staff svg")).toHaveCount(0);
  await send(page, 60);
  await expect(page.locator(".errors")).toHaveText("Ошибки: 0");
  const settings = await page.evaluate(() =>
    localStorage.getItem("sonari.settings.v2"),
  );
  await page
    .getByRole("button", {
      name: "Использовать доступный диапазон",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Тренировка", exact: true }),
  ).toHaveText("Своя тренировка");
  const note = Number(
    await page.locator(".staff svg").getAttribute("data-midi"),
  );
  expect(note).toBeGreaterThanOrEqual(36);
  expect(note).toBeLessThanOrEqual(59);
  expect(
    await page.evaluate(() => localStorage.getItem("sonari.settings.v2")),
  ).not.toBe(settings);
  await page
    .getByRole("button", { name: "Настройки", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Выбранные октавы", exact: true })
    .click();
});

test("device switch keeps separate profiles and duplicate identities require session-only confirmation", async ({
  page,
}) => {
  await setup(page, {
    custom: true,
    full: true,
    duplicate: true,
    profile: [21, 108],
  });
  await expect(wizard(page)).toHaveCount(0); // Previously offered; ambiguous saved bounds are ignored.
  await openAgain(page);
  await calibrate(page, 48, 72);
  expect(
    Number(await page.locator(".staff svg").getAttribute("data-midi")),
  ).toBe(48);
  await page.evaluate(() => (window as any).__calibration.switch("b"));
  expect(
    Number(await page.locator(".staff svg").getAttribute("data-midi")),
  ).toBe(21);
  expect(
    JSON.parse(
      (await page.evaluate(() =>
        localStorage.getItem("sonari.midi.calibration.v1"),
      ))!,
    ).profiles[0].lowerMidiNote,
  ).toBe(21);
});

test("wizard fits all supported sizes and boundary MIDI 0/127 remains playable", async ({
  page,
}) => {
  await setup(page, { custom: true, full: true });
  for (const size of [
    { width: 760, height: 560 },
    { width: 900, height: 600 },
    { width: 1920, height: 1032 },
  ]) {
    await page.setViewportSize(size);
    await expect(
      wizard(page).getByRole("button", { name: "Начать", exact: true }),
    ).toBeInViewport();
    await expect(
      page.getByRole("heading", { name: "Настройка клавиатуры" }),
    ).toBeInViewport();
  }
  await wizard(page)
    .getByRole("button", { name: "Начать", exact: true })
    .click();
  await calibrate(page, 0, 127);
  await expect(page.locator(".staff svg")).toHaveAttribute("data-midi", "0");
  await expect(page.locator('.piano [data-midi="0"]')).toBeVisible();
});

test("separate device profiles persist and an empty custom intersection requires explicit repair", async ({
  page,
}) => {
  await setup(page, { custom: true, octaves: [4] });
  await wizard(page)
    .getByRole("button", { name: "Начать", exact: true })
    .click();
  await calibrate(page, 48, 76);
  await page.evaluate(() => (window as any).__calibration.switch("b"));
  await wizard(page)
    .getByRole("button", { name: "Начать", exact: true })
    .click();
  await calibrate(page, 24, 47);
  await expect(
    page.getByRole("heading", { name: "Выбранные ноты недоступны" }),
  ).toBeVisible();
  await expect(page.locator(".staff svg")).toHaveCount(0);
  const stored = JSON.parse(
    (await page.evaluate(() =>
      localStorage.getItem("sonari.midi.calibration.v1"),
    ))!,
  );
  expect(stored.profiles).toHaveLength(2);
  expect(
    stored.profiles.find((p: any) => p.identity === "a").lowerMidiNote,
  ).toBe(48);
  expect(
    stored.profiles.find((p: any) => p.identity === "b").lowerMidiNote,
  ).toBe(24);
  await page.evaluate(() => (window as any).__calibration.switch("a"));
  await expect(page.locator(".staff svg")).toHaveAttribute(
    "data-midi",
    /^(60|62|64|65|67|69|71)$/,
  );
  await page.reload();
  await expect(wizard(page)).toHaveCount(0);
  await expect(page.locator(".staff svg")).toHaveAttribute(
    "data-midi",
    /^(60|62|64|65|67|69|71)$/,
  );
});

test("wizard pauses existing feedback and virtual clicks cannot capture bounds; failed saves retain old profile", async ({
  page,
}) => {
  await setup(page, { profile: [21, 108] });
  await page.clock.install();
  await page.locator('.piano [data-midi="60"]').click();
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "1",
  );
  await openAgain(page);
  await page.locator('.piano [data-midi="21"]').count();
  await page.locator('.piano [data-midi="60"]').dispatchEvent("click");
  await expect(page.locator(".calibration-cards .active h2")).toHaveText(
    "Нажмите крайнюю левую клавишу",
  );
  await page.clock.runFor(2000);
  await expect(page.locator(".staff svg")).toHaveAttribute("data-midi", "60");
  await send(page, 48);
  await send(page, 72);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "sonari.midi.calibration.v1") throw new Error("quota");
      original.call(this, key, value);
    };
  });
  await wizard(page)
    .getByRole("button", { name: "Сохранить", exact: true })
    .click();
  await expect(wizard(page).getByRole("alert")).toContainText(
    "Не удалось сохранить",
  );
  expect(
    JSON.parse(
      (await page.evaluate(() =>
        localStorage.getItem("sonari.midi.calibration.v1"),
      ))!,
    ).profiles[0].lowerMidiNote,
  ).toBe(21);
  await wizard(page)
    .getByRole("button", { name: "Отмена", exact: true })
    .click();
  await page.clock.runFor(651);
  await expect(page.locator(".staff svg")).not.toHaveAttribute(
    "data-midi",
    "60",
  );
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "1",
  );
  await expect(page.locator(".errors")).toHaveText("Ошибки: 0");
});
