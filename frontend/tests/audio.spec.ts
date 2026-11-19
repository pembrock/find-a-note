import { test, expect, type Page } from "@playwright/test";
import { rememberExpandedSettings } from "./settings-fixture";
test.beforeEach(async ({ page }) => {
  await rememberExpandedSettings(page);
});

async function prepare(page: Page) {
  await page.addInitScript(() => {
    Math.random = () => 0;
    const log: any[] = [];
    (window as any).__audioLog = log;
    const setGain = AudioParam.prototype.setValueAtTime;
    AudioParam.prototype.setValueAtTime = function (
      value: number,
      time: number,
    ) {
      log.push({ type: "param", value });
      return setGain.call(this, value, time);
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (
      ...args: Parameters<typeof start>
    ) {
      if (this.buffer && this.buffer.duration > 0.1)
        log.push({
          type: "start",
          rate: this.playbackRate.value,
          duration: this.buffer.duration,
        });
      return start.apply(this, args);
    };
    const stop = AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.stop = function (
      ...args: Parameters<typeof stop>
    ) {
      if (this.buffer && this.buffer.duration > 0.1) log.push({ type: "stop" });
      return stop.apply(this, args);
    };
    const listeners = new Map<string, Function[]>();
    const devices = [
      { id: "0", name: "SE25", identity: "controller" },
      { id: "1", name: "Yamaha P-45", identity: "piano" },
    ];
    let state: any = {
      devices,
      selected: null,
      status: "virtual",
      session: "0",
      revision: 0,
      message: "",
    };
    const emit = (name: string, value: any) =>
      listeners.get(name)?.forEach((fn) => fn(value));
    (window as any).runtime = {
      EventsOnMultiple: (name: string, fn: Function) => {
        listeners.set(name, [...(listeners.get(name) ?? []), fn]);
        return () => {};
      },
    };
    const publish = () => {
      state.revision++;
      emit("midi:state", structuredClone(state));
      return structuredClone(state);
    };
    (window as any).go = {
      main: {
        App: {
          GetMIDIState: async () => structuredClone(state),
          RefreshMIDIDevices: async () => publish(),
          ConnectMIDI: async (id: string) => {
            state = {
              ...state,
              selected: devices.find((d) => d.id === id),
              status: "connected",
              session: String(Number(state.session) + 1),
            };
            return publish();
          },
          DisconnectMIDI: async () => {
            state = {
              ...state,
              selected: null,
              status: "virtual",
              session: String(Number(state.session) + 1),
            };
            return publish();
          },
        },
      },
    };
    (window as any).__audioMidi = (
      type: string,
      note: number,
      velocity = 100,
      channel = 1,
    ) =>
      emit("midi:note", {
        type,
        note,
        velocity,
        channel,
        session: state.session,
      });
    (window as any).__connect = (id: string) =>
      (window as any).go.main.App.ConnectMIDI(id);
    (window as any).__usb = (present: boolean) => {
      state = {
        ...state,
        devices: present ? devices : devices.filter((d) => d.id !== "0"),
        status: "virtual",
        selected: null,
        session: String(Number(state.session) + 1),
      };
      publish();
    };
    localStorage.setItem(
      "sonari.midi.calibration.v1",
      JSON.stringify({
        version: 1,
        profiles: [],
        offered: ["controller", "piano"],
      }),
    );
  });
  // Only the local app is reachable, including during initial sample loading.
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1"
      ? route.continue()
      : route.abort(),
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Настройки", exact: true })
    .first()
    .click();
  await expect(page.getByText("Загрузка фортепиано…")).toHaveCount(0, {
    timeout: 20000,
  });
  const unlock = page.getByRole("button", {
    name: "Включить звук",
    exact: true,
  });
  if (await unlock.count()) await unlock.first().click();
  await expect(unlock).toHaveCount(0);
}
async function count(page: Page, type: string) {
  return page.evaluate(
    (type) =>
      (window as any).__audioLog.filter((e: any) => e.type === type).length,
    type,
  );
}

test("local decoded piano: pointer hold/release, cancellation, volume and persisted mute", async ({
  page,
}) => {
  await prepare(page);
  const key = page.locator('button[data-midi="60"]');
  const starts = await count(page, "start");
  await key.dispatchEvent("pointerdown", { button: 0, pointerId: 7 });
  expect(await count(page, "start")).toBe(starts + 1);
  const stops = await count(page, "stop");
  await key.dispatchEvent("pointerup", { pointerId: 7 });
  await expect.poll(() => count(page, "stop")).toBe(stops + 1);
  await key.dispatchEvent("pointerdown", { button: 0, pointerId: 8 });
  await key.dispatchEvent("pointerout", { pointerId: 8 });
  await expect.poll(() => count(page, "stop")).toBe(stops + 2);
  await page.getByRole("slider", { name: "Громкость" }).fill("25");
  await page.getByRole("switch", { name: "Воспроизводить звук" }).click();
  await page.reload();
  await page
    .getByRole("button", { name: "Настройки", exact: true })
    .first()
    .click();
  await expect(page.getByRole("slider", { name: "Громкость" })).toHaveValue(
    "25",
  );
  await expect(
    page.getByRole("switch", { name: "Воспроизводить звук" }),
  ).toHaveAttribute("aria-checked", "false");
});

test("MIDI audio remains independent of answers, polyphony, source preferences and disconnect", async ({
  page,
}) => {
  await prepare(page);
  await page.evaluate(() => (window as any).__connect("0"));
  const toggle = page.getByRole("switch", { name: "Воспроизводить звук" });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  const starts = await count(page, "start");
  await page.evaluate(() => {
    for (const n of [60, 64, 67]) (window as any).__audioMidi("noteon", n);
  });
  expect(await count(page, "start")).toBe(starts + 3);
  const stops = await count(page, "stop");
  await page.evaluate(() => (window as any).__audioMidi("noteoff", 64, 0));
  await expect.poll(() => count(page, "stop")).toBe(stops + 1);
  await page.evaluate(() => (window as any).__connect("1"));
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => count(page, "stop")).toBe(stops + 3);
  await page.evaluate(() => (window as any).__connect("0"));
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await page.evaluate(() => (window as any).__audioMidi("noteon", 69));
  await toggle.click();
  await expect.poll(() => count(page, "stop")).toBe(stops + 4);
});

test("sample failure leaves exercises usable", async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0;
  });
  await page.route("**/audio/salamander/*.mp3", (route) => route.abort());
  await page.goto("/");
  await page
    .getByRole("button", { name: "Настройки", exact: true })
    .first()
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Не удалось загрузить фортепиано",
  );
  await page.getByRole("button", { name: "Звук", exact: true }).click();
  await expect(page.getByRole("button", { name: "Звук", exact: true })).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("alert")).toBeVisible();
  const target = await page.locator(".staff svg").getAttribute("data-midi");
  await page.locator(`button[data-midi="${target}"]`).click();
  await expect(page.getByText("Верно!", { exact: true })).toBeVisible();
});

test("velocity, held correct answer, focus loss and silent calibration", async ({
  page,
}) => {
  await prepare(page);
  await page.evaluate(() => (window as any).__connect("0"));
  const attack = async (velocity: number) =>
    page.evaluate((velocity) => {
      (window as any).__audioLog.length = 0;
      (window as any).__audioMidi("noteon", 60, velocity);
      return (window as any).__audioLog
        .filter((e: any) => e.type === "param")
        .map((e: any) => e.value);
    }, velocity);
  const soft = await attack(30);
  const stops = await count(page, "stop");
  await expect(page.getByText("Верно!", { exact: true })).toBeVisible();
  expect(await count(page, "stop")).toBe(stops);
  await page.evaluate(() => (window as any).__audioMidi("noteoff", 60, 0));
  await expect.poll(() => count(page, "stop")).toBe(stops + 1);
  const hard = await attack(120);
  expect(Math.max(...hard.filter((v: number) => v <= 1))).toBeGreaterThan(
    Math.max(...soft.filter((v: number) => v <= 1)),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect.poll(() => count(page, "stop")).toBe(1);
  await page
    .getByRole("button", { name: "Устройство ввода", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Определить диапазон", exact: true })
    .click();
  const starts = await count(page, "start");
  await page.evaluate(() => (window as any).__audioMidi("noteon", 69));
  expect(await count(page, "start")).toBe(starts);
});

test("sound settings fit supported window sizes", async ({ page }) => {
  await prepare(page);
  for (const [width, height] of [
    [900, 600],
    [760, 560],
    [1920, 1032],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(page.getByRole("slider", { name: "Громкость" })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});

test("accordion and language changes preserve held MIDI audio, connection and calibration", async ({
  page,
}) => {
  await prepare(page);
  await page.evaluate(() => (window as any).__connect("0"));
  await page.evaluate(() => (window as any).__audioMidi("noteon", 64));
  const stops = await count(page, "stop");
  const before = await page.evaluate(async () => ({
    state: await (window as any).go.main.App.GetMIDIState(),
    calibration: localStorage.getItem("sonari.midi.calibration.v1"),
  }));
  for (const header of await page.locator(".section-trigger").all()) {
    await header.click();
    await header.click();
  }
  await page.getByRole("button", { name: "Общие", exact: true }).click();
  await page.getByRole("combobox", { name: "Язык приложения" }).selectOption("en");
  await expect(page.getByRole("button", { name: "Input device", exact: true })).toContainText("SE25");
  expect(await count(page, "stop")).toBe(stops);
  expect(
    await page.evaluate(async () => ({
      state: await (window as any).go.main.App.GetMIDIState(),
      calibration: localStorage.getItem("sonari.midi.calibration.v1"),
    })),
  ).toEqual(before);
  await page.evaluate(() => (window as any).__audioMidi("noteoff", 64, 0));
  await expect.poll(() => count(page, "stop")).toBe(stops + 1);
});

test("MIDI sound controls share per-device state across USB and reload", async ({ page }, testInfo) => {
  await prepare(page);
  const trigger = page.getByRole("button", { name: "Устройство ввода", exact: true });
  const menu = page.getByRole("dialog", { name: "Устройство ввода" });
  const quick = menu.getByRole("switch", { name: "Воспроизводить звук" });
  const settings = page.locator("aside").getByRole("switch", { name: "Воспроизводить звук" });
  await trigger.click();
  await menu.getByRole("button", { name: "SE25", exact: true }).click();
  await expect(quick).toHaveAttribute("aria-checked", "true");
  for (const [width, height] of [[760, 560], [900, 600], [1920, 1032]]) {
    await page.setViewportSize({ width, height });
    await expect(quick).toBeInViewport();
    if (width === 900) await page.screenshot({ path: testInfo.outputPath("midi-menu.png") });
  }

  await quick.click();
  await expect(settings).toHaveAttribute("aria-checked", "false");
  const starts = await count(page, "start");
  await page.evaluate(() => (window as any).__audioMidi("noteon", 60));
  expect(await count(page, "start")).toBe(starts);
  await menu.getByRole("button", { name: "Yamaha P-45", exact: true }).click();
  await expect(quick).toHaveAttribute("aria-checked", "true");
  await menu.getByRole("button", { name: "SE25", exact: true }).click();
  await expect(quick).toHaveAttribute("aria-checked", "false");

  await page.evaluate(() => (window as any).__usb(false));
  await expect(quick).toHaveCount(0);
  await page.evaluate(() => (window as any).__usb(true));
  await expect(quick).toHaveAttribute("aria-checked", "false");
  await page.reload();
  await expect(trigger).toContainText("SE25");
  await trigger.click();
  await expect(quick).toHaveAttribute("aria-checked", "false");

  await page.getByRole("button", { name: "Настройки", exact: true }).first().click();
  await settings.click();
  await trigger.click();
  await expect(quick).toHaveAttribute("aria-checked", "true");
  await page.reload();
  await expect(trigger).toContainText("SE25");
  await trigger.click();
  await expect(quick).toHaveAttribute("aria-checked", "true");
});
