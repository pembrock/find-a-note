import { test, expect, type Page } from "@playwright/test";
import { rememberExpandedSettings } from "./settings-fixture";
test.beforeEach(async ({ page }) => { await rememberExpandedSettings(page); });

test("remembered unplugged piano connects automatically when attached after startup", async ({
  page,
}) => {
  await installMIDI(page, { devices: 0, preferred: "piano-0" });
  await page.goto("/");
  const device = page.getByRole("button", {
    name: "Устройство ввода",
    exact: true,
  });
  await expect(device).toContainText("MIDI-устройства не обнаружены");
  await page.evaluate(() => (window as any).__midi.attach());
  await expect(device).toContainText("Подключено (MIDI)");
  expect(await page.evaluate(() => (window as any).__midi.calls)).toEqual([
    "connect:0",
  ]);
});

async function installMIDI(
  page: Page,
  options: {
    devices?: number;
    preferred?: string;
    fail?: boolean;
    custom?: boolean;
  } = {},
) {
  await page.addInitScript((options) => {
    Math.random = () => 0;
    const listeners = new Map<string, Set<(data: any) => void>>();
    const devices = Array.from({ length: options.devices ?? 2 }, (_, i) => ({
      id: String(i),
      name: `Test Piano ${i + 1}`,
      identity: options.preferred === "duplicate" ? "duplicate" : `piano-${i}`,
    }));
    let state: any = {
      devices,
      selected: null,
      status: "virtual",
      message: "",
      session: "0",
      revision: 1,
    };
    const calls: string[] = [];
    if (!localStorage.getItem("sonari.midi.calibration.v1"))
      localStorage.setItem(
        "sonari.midi.calibration.v1",
        JSON.stringify({
          version: 1,
          profiles: [],
          offered: ["piano-0", "piano-1", "duplicate"],
        }),
      );
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
            RefreshMIDIDevices: async () => {
              calls.push("refresh");
              return publish();
            },
            ConnectMIDI: async (id: string) => {
              calls.push(`connect:${id}`);
              state.session = String(Number(state.session) + 1);
              state.selected = devices.find((d) => d.id === id);
              state.status = options.fail ? "error" : "connected";
              state.message = options.fail
                ? "Не удалось подключиться: порт занят"
                : "";
              return publish();
            },
            DisconnectMIDI: async () => {
              calls.push("disconnect");
              state = {
                ...state,
                session: String(Number(state.session) + 1),
                selected: null,
                status: "virtual",
                message: "",
              };
              return publish();
            },
          },
        },
      },
      __midi: {
        calls,
        send: (
          note: number,
          velocity = 100,
          type = "noteon",
          session = state.session,
        ) => emit("midi:note", { note, velocity, type, session, channel: 1 }),
        remove: () => {
          state = {
            ...state,
            devices: [],
            status: "error",
            message: "MIDI-устройство отключено",
            session: String(Number(state.session) + 1),
          };
          publish();
        },
        attach: () => {
          const device = { id: "0", name: "Test Piano 1", identity: "piano-0" };
          devices.push(device);
          state.devices = [...devices];
          publish();
        },
        subscriptions: () =>
          [...listeners.values()].reduce((n, set) => n + set.size, 0),
      },
    });
    if (options.preferred && !sessionStorage.getItem("preference-seeded")) {
      localStorage.setItem(
        "sonari.midi.input.v1",
        JSON.stringify(options.preferred),
      );
      sessionStorage.setItem("preference-seeded", "true");
    }
    if (options.custom) {
      localStorage.setItem(
        "sonari.training.v1",
        JSON.stringify({ mode: "custom" }),
      );
      localStorage.setItem(
        "sonari.settings.v2",
        JSON.stringify({
          version: 2,
          octaves: [4],
          exact: false,
          letter: false,
          russian: false,
        }),
      );
    }
  }, options);
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
      (window as any).__midi.send(note, velocity, type, session),
    { note, velocity, type, session },
  );
}

test("physical MIDI shares feedback, counters, timer and stale-session protection with virtual input", async ({
  page,
}) => {
  await installMIDI(page, { custom: true });
  await page.setViewportSize({ width: 760, height: 560 });
  await page.goto("/");
  await page.clock.install();
  const settings = await page.evaluate(() =>
    localStorage.getItem("sonari.settings.v2"),
  );
  const device = page.getByRole("button", {
    name: "Устройство ввода",
    exact: true,
  });
  await device.click();
  const menu = page.getByRole("dialog", { name: "Устройство ввода" });
  await menu
    .getByRole("button", { name: "Test Piano 1", exact: false })
    .click();
  await expect(device).toContainText("Подключено (MIDI)");
  expect(
    await page.evaluate(() => (window as any).__midi.subscriptions()),
  ).toBe(2);
  await send(page, 60, 0);
  await send(page, 60, 70, "noteoff");
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "0",
  );
  await send(page, 21);
  await expect(page.locator(".errors")).toHaveText("Ошибки: 1");
  await expect(page.locator(".octaves")).toHaveText("C4–B5");
  await expect(page.locator(".note-names")).toBeEmpty();
  await send(page, 72); // Any octave accepts C5 for the target C4.
  await send(page, 72);
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "1",
  );
  await expect(page.locator(".answer-correct")).toHaveAttribute(
    "data-midi",
    "72",
  );
  await expect(page.locator(".letter")).toHaveText("C4");
  await expect(page.locator(".octave-name")).toHaveText("Первая октава");
  await expect(menu.locator(".midi-diagnostic")).toContainText("MIDI 72");
  await page.clock.runFor(1201);
  await expect(page.locator(".letter")).toHaveCount(0);
  const target = Number(
    await page.locator(".staff svg").getAttribute("data-midi"),
  );
  await menu
    .getByRole("button", { name: "Test Piano 2", exact: false })
    .click();
  await send(page, target, 100, "noteon", "1");
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "1",
  );
  await send(page, target);
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "2",
  );
  await menu
    .getByRole("button", { name: "Виртуальная клавиатура", exact: false })
    .click();
  await expect(device).toContainText("MIDI не подключено");
  await page.clock.runFor(1201);
  await send(page, 60);
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "2",
  );
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(device).toBeFocused();
  const next = await page.locator(".staff svg").getAttribute("data-midi");
  await page.locator(`.piano [data-midi="${next}"]`).click();
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "3",
  );
  expect(
    await page.evaluate(() => localStorage.getItem("sonari.settings.v2")),
  ).toBe(settings);
});

test("remembered input restores only an exact unambiguous identity and virtual selection persists", async ({
  page,
}) => {
  await installMIDI(page, { preferred: "piano-1" });
  await page.goto("/");
  const device = page.getByRole("button", {
    name: "Устройство ввода",
    exact: true,
  });
  await expect(device).toContainText("Test Piano 2");
  await expect(device).toContainText("Подключено (MIDI)");
  await device.click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Виртуальная клавиатура", exact: false })
    .click();
  await page.reload();
  await expect(device).toContainText("Виртуальная клавиатура");
  expect(await page.evaluate(() => (window as any).__midi.calls)).toEqual([]);
  expect(
    await page.evaluate(() => (window as any).__midi.subscriptions()),
  ).toBe(2);
});

test("ambiguous or missing remembered devices never connect a random input", async ({
  page,
}) => {
  await installMIDI(page, { preferred: "duplicate" });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Устройство ввода", exact: true })
    .click();
  await expect(
    page.getByText(
      "Найдено несколько одинаковых MIDI-устройств. Выбери нужное вручную.",
    ),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).__midi.calls)).toEqual([]);
  await page.evaluate(() =>
    localStorage.setItem("sonari.midi.input.v1", JSON.stringify("absent")),
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Устройство ввода", exact: true }),
  ).toContainText("Виртуальная клавиатура");
  expect(await page.evaluate(() => (window as any).__midi.calls)).toEqual([]);
});

test("connection failure and unplug leave virtual exercises available and allow retry", async ({
  page,
}) => {
  await installMIDI(page, { fail: true });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Устройство ввода", exact: true })
    .click();
  const menu = page.getByRole("dialog");
  await menu
    .getByRole("button", { name: "Test Piano 1", exact: false })
    .click();
  await expect(menu.getByRole("alert")).toContainText("порт занят");
  await expect(page.locator(".midi-connected")).toHaveCount(0);
  await menu.getByRole("button", { name: "Повторить подключение" }).click();
  expect(await page.evaluate(() => (window as any).__midi.calls)).toEqual([
    "connect:0",
    "connect:0",
  ]);
  await menu.getByRole("button", { name: "Обновить список" }).click();
  await page.evaluate(() => (window as any).__midi.remove());
  await expect(menu.getByRole("alert")).toContainText("отключено");
  await expect(menu.getByText("MIDI-устройства не обнаружены")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator('.piano [data-midi="60"]').click();
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "1",
  );
});

test("no-device menu fits 760x560 and closes using keyboard or outside click", async ({
  page,
}) => {
  await installMIDI(page, { devices: 0 });
  await page.setViewportSize({ width: 760, height: 560 });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Устройство ввода", exact: true })
    .click();
  const menu = page.getByRole("dialog");
  const bounds = await menu.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(760);
  await expect(menu.getByText("MIDI-устройства не обнаружены")).toBeVisible();
  await page.locator(".staff").click();
  await expect(menu).toHaveCount(0);
});
