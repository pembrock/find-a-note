// SPDX-License-Identifier: GPL-3.0-only
import { mkdir } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import config from "../../wails.json" with { type: "json" };

async function launch(
  page: Page,
  {
    phase = "available",
    result = "current",
    notice = "",
    notes = "Улучшено окно обновления.",
    total = 12 * 1024 ** 2,
    manual = false,
  } = {},
) {
  await page.addInitScript(
    ({ phase, result, notice, notes, total, manual }) => {
      const offer = {
        version: "0.3.1",
        notes,
        progress: 0,
        received: 0,
        total: 0,
        problem: "",
        manual,
      };
      const statusFor = (phase: string) => ({
        ...offer,
        phase,
        verifiedSHA256: phase === "ready" && manual ? "a".repeat(64) : "",
        version: ["idle", "checking", "current", "check-error"].includes(phase)
          ? ""
          : offer.version,
      });
      let state = statusFor(phase);
      let finish = () => {};
      let finishCheck = () => {};
      const control = {
        url: "",
        checks: 0,
        installs: 0,
        cancels: 0,
        done: (next: string) => {
          state = statusFor(next);
          finish();
        },
        checkDone: () => {
          state = statusFor(result);
          finishCheck();
        },
      };
      Object.assign(window, {
        updateTest: control,
        ...(manual && { runtime: { BrowserOpenURL: (url: string) => { control.url = url; } } }),
        go: {
          main: {
            UpdateBridge: {
              Status: async () => state,
              FrontendReady: async () => {
                if (sessionStorage.getItem("update-notice-consumed")) return "";
                sessionStorage.setItem("update-notice-consumed", "1");
                return notice;
              },
              Check: async () => {
                control.checks++;
                state = statusFor("checking");
                await new Promise<void>((resolve) => {
                  finishCheck = resolve;
                });
              },
              Download: async () => {
                state = {
                  ...offer,
                  phase: "downloading",
                  progress: 65,
                  received: 8 * 1024 ** 2,
                  total,
                };
                await new Promise<void>((resolve) => {
                  finish = resolve;
                });
              },
              Cancel: async () => {
                control.cancels++;
                control.done("available");
              },
              Install: async () => {
                control.installs++;
                state = statusFor("installing");
              },
            },
          },
        },
      });
    },
    { phase, result, notice, notes, total, manual },
  );
  await page.goto("/");
}

const badgeFor = (page: Page) =>
  page.getByRole("button", { name: "Обновления Find a Note" });

test("switches signed-note language without closing the update dialog", async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 560 });
  const englishNotes = "- English notes\n" + "uninterruptedtext".repeat(64);
  await launch(page, { notes: `English\n\n${englishNotes}\n\nРусский\n\n- Русские заметки` });
  await badgeFor(page).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("region")).toHaveText("- Русские заметки");
  await dialog.getByRole("combobox", { name: "Язык приложения" }).selectOption("en");
  await expect(dialog.getByRole("heading", { name: "Update available" })).toBeVisible();
  const notes = dialog.getByRole("region");
  await expect(notes).toHaveText(englishNotes);
  for (const [width, height] of [[760, 560], [900, 600], [1920, 1032]]) {
    await page.setViewportSize({ width, height });
    await expect(dialog.getByRole("button", { name: "Update", exact: true })).toBeInViewport();
    expect(await notes.evaluate((node) => node.scrollWidth === node.clientWidth)).toBe(true);
  }
});
async function manualCheck(page: Page) {
  await page.getByTitle("Настройки", { exact: true }).click();
  await page.getByText("О программе", { exact: true }).click();
  await page.getByRole("button", { name: "Проверить обновления" }).click();
}

test("background offer, keyboard navigation and focus restoration", async ({
  page,
  browserName,
}) => {
  const tab = process.platform === "darwin" && browserName === "webkit" ? "Alt+Tab" : "Tab";
  await launch(page);
  const badge = badgeFor(page);
  await badge.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Доступно обновление" }),
  ).toBeFocused();
  await expect(dialog.getByText("Find a Note 0.3.1")).toBeVisible();
  await expect(dialog.getByText(`Установлена версия ${config.info.productVersion}`)).toBeVisible();
  await expect(page.getByText("О программе", { exact: true })).toHaveCount(0);
  await page.keyboard.press(tab);
  await expect(dialog.getByRole("region")).toBeFocused();
  await page.keyboard.press(tab);
  await expect(dialog.getByRole("button", { name: "Позже" })).toBeFocused();
  expect(
    await dialog
      .getByRole("button", { name: "Позже" })
      .evaluate((node) => getComputedStyle(node).outlineStyle),
  ).toBe("solid");
  await page.keyboard.press(tab);
  await expect(dialog.getByRole("button", { name: "Обновить" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(badge).toBeFocused();
  await badge.click();
  await dialog.getByRole("button", { name: "Позже" }).click();
  await expect(badge).toBeVisible();
});

for (const [result, title] of [
  ["current", "Установлена последняя версия"],
  ["check-error", "Не удалось проверить обновления"],
  ["available", "Доступно обновление"],
]) {
  test(`manual check: ${result}`, async ({ page }) => {
    await launch(page, { phase: "idle", result });
    await manualCheck(page);
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Проверяем обновления…" }),
    ).toBeVisible();
    await page.evaluate(() => (window as any).updateTest.checkDone());
    await expect(dialog.getByRole("heading", { name: title })).toBeVisible();
    if (result === "check-error") {
      await dialog.getByRole("button", { name: "Повторить" }).click();
      await expect(
        dialog.getByRole("heading", { name: "Проверяем обновления…" }),
      ).toBeVisible();
      await page.evaluate(() => (window as any).updateTest.checkDone());
      await expect(dialog.getByRole("alert")).toBeVisible();
    }
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "Проверить обновления" }),
    ).toBeFocused();
  });
}

test("download progress, cancellation, failure, deferral and restart confirmation", async ({
  page,
}) => {
  await launch(page);
  const badge = badgeFor(page);
  await badge.click();
  const download = page.getByRole("button", { name: "Обновить", exact: true });
  const progress = page.getByRole("progressbar", {
    name: "Загрузка обновления",
  });
  await download.click();
  await expect(progress).toHaveAttribute("value", "65");
  await expect(page.getByText("65% · Загружено 8 МБ из 12 МБ")).toBeVisible();
  await page.getByRole("button", { name: "Отмена" }).click();
  await expect(download).toBeVisible();
  await download.click();
  await expect(progress).toHaveAttribute("value", "65");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(badge).toBeFocused();
  expect(await page.evaluate(() => (window as any).updateTest.cancels)).toBe(2);
  await badge.click();
  await download.click();
  await expect(progress).toHaveAttribute("value", "65");
  await page.evaluate(() => (window as any).updateTest.done("download-error"));
  await expect(page.getByRole("alert")).toContainText("Загрузка прервалась");
  await page.getByRole("button", { name: "Повторить" }).click();
  await expect(progress).toHaveAttribute("value", "65");
  await page.evaluate(() => (window as any).updateTest.done("ready"));
  const restart = page.getByRole("button", {
    name: "Перезапустить",
    exact: true,
  });
  await expect(restart).toBeVisible();
  await page.getByRole("button", { name: "Позже" }).click();
  await badge.click();
  await restart.click();
  await page.getByRole("button", { name: "Назад" }).click();
  await restart.click();
  expect(await page.evaluate(() => (window as any).updateTest.installs)).toBe(
    0,
  );
  await page.getByRole("button", { name: "Подтвердить перезапуск" }).click();
  await expect(page.getByText("Подготавливаем перезапуск…")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await page.evaluate(() => (window as any).updateTest.installs)).toBe(
    1,
  );
});

test("indeterminate download has no fabricated percentage", async ({
  page,
}) => {
  await launch(page, { total: 0 });
  await badgeFor(page).click();
  await page.getByRole("button", { name: "Обновить", exact: true }).click();
  await expect(page.getByText("Загружено 8 МБ")).toBeVisible();
  await expect(
    page.getByRole("progressbar", { name: "Загрузка обновления" }),
  ).not.toHaveAttribute("value");
});

for (const notice of ["updated", "recovered", ""]) {
  test(`first-launch notification: ${notice || "ordinary startup"}`, async ({
    page,
  }) => {
    await launch(page, { phase: "current", notice });
    const result = page.getByRole("complementary", {
      name: "Результат обновления",
    });
    if (notice) {
      await expect(result).toContainText(
        notice === "updated"
          ? "Find a Note обновлён"
          : "Предыдущая версия восстановлена",
      );
      await result.getByRole("button", { name: "Понятно" }).click();
    }
    await expect(result).toHaveCount(0);
    await expect(
      page.getByText("Find a Note обновлён", { exact: true }),
    ).toHaveCount(0);
    await page.reload();
    await expect(result).toHaveCount(0);
  });
}

for (const [width, height] of [
  [760, 560],
  [900, 600],
  [1920, 1032],
]) {
  test(`contained release notes at ${width}×${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const html = "<img src=x onerror=alert(1)>";
    await launch(page, {
      notes: [
        "• Улучшено отображение на небольших экранах.",
        "• Уточнены подсказки при выборе MIDI-устройства.",
        "• Добавлены данные о ходе загрузки.",
        "",
        "Заметки к выпуску можно прокручивать в этом окне. Кнопки действий остаются под текстом.",
        "",
        ...Array(16).fill("Улучшена отзывчивость интерфейса."),
        html,
        "длиннаястрока".repeat(64),
      ].join("\n"),
    });
    await badgeFor(page).click();
    const dialog = page.getByRole("dialog");
    const notes = dialog.getByRole("region");
    await expect(notes).toContainText(html);
    await expect(notes.locator("img")).toHaveCount(0);
    expect(
      await notes.evaluate(
        (node) =>
          node.scrollHeight > node.clientHeight &&
          node.scrollWidth === node.clientWidth,
      ),
    ).toBe(true);
    const bounds = (await dialog.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(height);
    await expect(
      dialog.getByRole("button", { name: "Обновить" }),
    ).toBeInViewport();
    if (process.env.FAN_UPDATE_SCREENSHOTS) {
      const output = process.env.FAN_UPDATE_SCREENSHOTS;
      await mkdir(output, { recursive: true });
      await page.screenshot({
        path: `${output}/update-dialog-${width}x${height}.png`,
      });
      if (width === 760) {
        await dialog.getByRole("button", { name: "Обновить" }).click();
        await expect(dialog.getByRole("progressbar")).toHaveAttribute(
          "value",
          "65",
        );
        await page.screenshot({
          path: `${output}/update-download-760x560.png`,
        });
        await page.evaluate(() => (window as any).updateTest.done("ready"));
        await expect(
          dialog.getByRole("heading", { name: "Обновление готово" }),
        ).toBeVisible();
        await page.screenshot({ path: `${output}/update-ready-760x560.png` });
      }
    }
  });
}

test("manual macOS update verifies the DMG before opening GitHub and offers no install", async ({ page }) => {
  await launch(page, { manual: true, notes: "English\n\n- English notes\n\nРусский\n\n- Русские заметки" });
  await badgeFor(page).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("region")).toHaveText("- Русские заметки");
  const verify = dialog.getByRole("button", { name: "Проверить DMG" });
  await expect(dialog.getByRole("button", { name: "Открыть релиз GitHub" })).toHaveCount(0);
  await verify.click();
  await expect(dialog.getByRole("progressbar")).toBeVisible();
  await page.evaluate(() => (window as any).updateTest.done("ready"));
  await expect(dialog.getByText("a".repeat(64))).toBeVisible();
  await dialog.getByRole("combobox", { name: "Язык приложения" }).selectOption("en");
  await expect(dialog.getByRole("region")).toHaveText("- English notes");
  await expect(dialog.getByRole("button", { name: /restart|install/i })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Open GitHub release" }).click();
  expect(await page.evaluate(() => (window as any).updateTest.url)).toBe(
    "https://github.com/pembrock/find-a-note/releases/tag/v0.3.1",
  );
  expect(await page.evaluate(() => (window as any).updateTest.installs)).toBe(0);
});
