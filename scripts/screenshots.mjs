// Playwright verification: iPhone-sized viewports, first three cards, plus a light-mode and an offline check.
// Usage: node scripts/screenshots.mjs [baseUrl]   (default http://127.0.0.1:4173)
import { chromium, devices } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'shots');
const base = process.argv[2] || 'http://127.0.0.1:4173';
await mkdir(OUT, { recursive: true });

const sizes = [
  { name: '390x844', width: 390, height: 844 },
  { name: '430x932', width: 430, height: 932 },
];
// Headless Chromium cannot reach the internet from the build VM (its egress proxy resets browser traffic),
// so thumbnails are fetched with curl and handed to the page via route interception. Test scaffolding only;
// the app itself is untouched. Set THIRTY_NO_ROUTE=1 to disable.
import { execFileSync } from 'node:child_process';
const thumbCache = new Map();
async function routeThumbs(page) {
  if (process.env.THIRTY_NO_ROUTE) return;
  await page.route(/^https:\/\/(i\d?\.ytimg\.com|cdn\.bsky\.app)\//, (route) => {
    const url = route.request().url();
    try {
      if (!thumbCache.has(url)) thumbCache.set(url, execFileSync('curl', ['-sS', '-m', '20', '-L', url], { maxBuffer: 10e6 }));
      route.fulfill({ status: 200, contentType: 'image/jpeg', body: thumbCache.get(url) });
    } catch { route.abort(); }
  });
}
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const results = [];
for (const s of sizes) {
  const ctx = await browser.newContext({
    ...devices['iPhone 13'],
    viewport: { width: s.width, height: s.height },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    colorScheme: 'dark',
    serviceWorkers: 'allow',
  });
  const page = await ctx.newPage();
  await routeThumbs(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.waitForSelector('.card[data-id]');
  // dismiss the install sheet if the UA triggered it
  if (await page.locator('#install[open]').count()) await page.click('#install-dismiss');
  const cards = page.locator('.card[data-id]');
  const n = await cards.count();
  for (let i = 0; i < 3; i++) {
    await cards.nth(i).scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, `${s.name}-card${i + 1}.png`) });
  }
  const strip = await page.locator('#built').textContent();
  const progress = await page.locator('#progress').textContent();
  const titles = [];
  for (let i = 0; i < 3; i++) titles.push(await cards.nth(i).locator('.title').textContent());
  // end of session card exists and is last
  const done = await page.locator('.card-done').count();
  results.push({ size: s.name, cards: n, strip, progress, titles, doneCard: done === 1, errors });

  if (s.name === '390x844') {
    // light palette screenshot
    await page.emulateMedia({ colorScheme: 'light' });
    await cards.nth(0).scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, `${s.name}-card1-light.png`) });
    await page.emulateMedia({ colorScheme: 'dark' });
    // settings sheet
    await page.click('#settings-btn');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, `${s.name}-settings.png`) });
    await page.click('#settings-close');
    // done card
    await page.locator('.card-done').scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, `${s.name}-done.png`) });
    // offline reopen: wait for SW to control, then go offline and reload
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForTimeout(1500);
    await ctx.setOffline(true);
    let offlineOk = false, offlineCards = 0, offlineStrip = '';
    try {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.card[data-id]', { timeout: 8000 });
      offlineCards = await page.locator('.card[data-id]').count();
      offlineStrip = await page.locator('#built').textContent();
      offlineOk = offlineCards > 0;
      await page.screenshot({ path: path.join(OUT, `${s.name}-offline.png`) });
    } catch (e) { offlineStrip = String(e).slice(0, 120); }
    await ctx.setOffline(false);
    results.push({ check: 'offline-reopen', ok: offlineOk, cards: offlineCards, strip: offlineStrip });
    // install screen on iOS Safari UA (not standalone)
    const ios = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
    const p2 = await ios.newPage();
    await routeThumbs(p2);
    await p2.goto(base + '/', { waitUntil: 'networkidle' });
    const installShown = await p2.locator('#install[open]').count();
    await p2.screenshot({ path: path.join(OUT, `${s.name}-install.png`) });
    results.push({ check: 'install-screen-on-ios-safari', shown: installShown === 1 });
    await ios.close();
  }
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(results, null, 1));
