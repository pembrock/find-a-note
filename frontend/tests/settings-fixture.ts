import type { Page } from "@playwright/test";

// Regression scenarios exercise existing controls in a remembered expanded panel.
// Default collapsed behaviour is covered separately in settings.spec.ts.
export async function rememberExpandedSettings(page: Page) {
  await page.addInitScript(() => {
    if (!localStorage.getItem("sonari.settings.sections.v1"))
      localStorage.setItem(
        "sonari.settings.sections.v1",
        JSON.stringify({
          version: 1,
          expanded: {
            sound: true,
            display: true,
            range: true,
            notation: true,
            training: true,
          },
        }),
      );
  });
}
