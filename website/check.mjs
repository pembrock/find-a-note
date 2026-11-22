import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chromium } from '../frontend/node_modules/playwright/index.mjs';
import { createPreviewServer } from './server.mjs';

const server = createPreviewServer().listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = 'http://127.0.0.1:' + server.address().port;
const url = origin + '/find-a-note/';

try {
  assert.equal((await fetch(origin, { redirect: 'manual' })).headers.get('location'), '/find-a-note/');
  assert.equal((await fetch(origin + '/assets/icon.png')).status, 404);
  assert.equal((await fetch(url + 'missing')).status, 404);

  const browser = await chromium.launch({ channel: 'msedge' });
  try {
    for (const width of [320, 390, 768, 1024, 1440, 1920]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      const failures = [];
      page.on('pageerror', (error) => failures.push(error.message));
      page.on('response', (response) => {
        if (response.status() >= 400) failures.push(response.url());
      });
      assert.equal((await page.goto(url)).status(), 200);
      assert.equal(await page.locator('html').getAttribute('lang'), 'ru');
      assert.equal(await page.getByRole('heading', { level: 1 }).textContent(), 'Find a Note');
      await page.keyboard.press('Tab');
      assert.equal(await page.locator(':focus').getAttribute('href'), '#main');
      await page.keyboard.press('Enter');
      assert.equal(await page.locator(':focus').getAttribute('id'), 'main');
      await page.getByRole('link', { name: 'Скачать Find a Note', exact: true }).click();
      assert.equal(new URL(page.url()).hash, '#download');
      assert.equal(await page.locator('.hero-figure').evaluate((figure) => getComputedStyle(figure).animationName), 'none');
      assert.equal(await page.locator('main img').count(), 3);
      for (const section of await page.locator('.practice, .midi, .download-panel').all()) {
        assert.equal(await section.evaluate((element) => getComputedStyle(element).animationName), 'none');
      }
      for (const image of await page.locator('main img').all()) {
        await image.scrollIntoViewIfNeeded();
        assert.ok(await image.evaluate(async (element) => {
          await element.decode();
          return element.naturalWidth > 0 && Boolean(element.alt);
        }));
      }
      for (const href of await page.locator('a[href^="#"]').evaluateAll((links) => links.map((link) => link.hash))) {
        assert.equal(await page.locator(href).count(), 1);
      }
      assert.equal(await page.locator('a[href*="/releases/download/"]').count(), 4);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.deepEqual(failures, []);
      await page.close();
      console.log('PASS Edge ' + width + 'px');
    }
    const motionPage = await browser.newPage({ reducedMotion: 'no-preference' });
    await motionPage.goto(url);
    assert.equal(await motionPage.locator('.hero-figure').evaluate((element) => getComputedStyle(element).animationName), 'arrive');
    const sectionMotion = await motionPage.locator('.practice').evaluate((element) => ({
      supported: CSS.supports('animation-timeline: view()') && CSS.supports('animation-range: entry 0% entry 65%'),
      name: getComputedStyle(element).animationName,
    }));
    assert.equal(sectionMotion.name, sectionMotion.supported ? 'section-arrive' : 'none');
    await motionPage.close();
    console.log('PASS motion preferences');
  } finally {
    await browser.close();
  }
} finally {
  server.close();
}
