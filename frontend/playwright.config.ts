import { defineConfig } from "@playwright/test";
// Keep Windows/Edge parity by default; opt in on hosts without Edge.
const browser = process.env.PLAYWRIGHT_BROWSER ?? "msedge";
if (!["msedge", "chromium", "webkit"].includes(browser)) {
  throw new Error(`Unsupported PLAYWRIGHT_BROWSER: ${browser}`);
}
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    browserName: browser === "webkit" ? "webkit" : "chromium",
    ...(browser === "msedge" ? { channel: "msedge" } : {}),
    locale: "ru-RU",
    headless: true,
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: false,
  },
});
