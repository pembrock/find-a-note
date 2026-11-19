// SPDX-License-Identifier: GPL-3.0-only
import { expect, test } from "@playwright/test";

test("offer can be deferred and installing requires a separate confirmation", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const initial = {
      phase: "available",
      version: "0.2.0",
      notes: "Заметка о выпуске",
      progress: 0,
    };
    let state = { ...initial };
    let finish = () => {};
    const control = {
      installs: 0,
      done: (phase: string) => {
        state = { ...state, phase, progress: phase === "ready" ? 100 : 0 };
        finish();
      },
    };
    Object.assign(window, {
      updateTest: control,
      go: {
        main: {
          UpdateBridge: {
            FrontendReady: async () => false,
            Status: async () => state,
            Check: async () => {
              state = { ...initial };
            },
            Download: async () => {
              state = { ...initial, phase: "downloading", progress: 32 };
              await new Promise<void>((resolve) => {
                finish = resolve;
              });
            },
            Cancel: async () => control.done("available"),
            Install: async () => {
              control.installs++;
              state = { ...initial, phase: "installing" };
            },
          },
        },
      },
    });
  });
  await page.goto("/");
  const badge = page.getByRole("button", { name: "Обновления Find a Note" });
  await badge.click();
  await expect(page.getByText("Заметка о выпуске")).toBeVisible();
  await page.getByRole("button", { name: "Позже" }).click();
  await expect(badge).toHaveCount(0);
  await page.reload();
  await page.getByTitle("Настройки", { exact: true }).click();
  await page.getByText("О программе", { exact: true }).click();
  const check = page.getByRole("button", { name: "Проверить обновления" });
  await expect(check).toBeVisible();
  await expect(badge).toHaveCount(0);
  await check.click();
  const download = page.getByRole("button", { name: "Скачать обновление" });
  const progress = page.getByRole("progressbar", {
    name: "Загрузка обновления",
  });
  await download.click();
  await expect(progress).toHaveAttribute("value", "32");
  await page.getByRole("button", { name: "Отменить загрузку" }).click();
  await download.click();
  await expect(progress).toBeVisible();
  await page.evaluate(() => (window as any).updateTest.done("download-error"));
  await page.getByRole("button", { name: "Повторить загрузку" }).click();
  await expect(progress).toBeVisible();
  await page.evaluate(() => (window as any).updateTest.done("ready"));
  const install = page.getByRole("button", { name: "Установить обновление" });
  await install.click();
  await expect(
    page.getByRole("button", { name: "Подтвердить перезапуск" }),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).updateTest.installs)).toBe(
    0,
  );
  await page.getByRole("button", { name: "Назад" }).click();
  await install.click();
  await page.getByRole("button", { name: "Подтвердить перезапуск" }).click();
  await expect(page.getByText("Подготавливаем перезапуск…")).toBeVisible();
  expect(await page.evaluate(() => (window as any).updateTest.installs)).toBe(
    1,
  );
});
