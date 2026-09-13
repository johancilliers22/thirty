// Playwright verification: iPhone-sized viewports, first three cards, plus a light-mode and an offline check.
// Usage: node scripts/screenshots.mjs [baseUrl]   (default http://127.0.0.1:4173)
import { chromium, devices } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// THIRTY_SHOTS_DIR lets a QA run keep its shots (docs/qa/<date>) instead of the gitignored scratch dir
const OUT = path.resolve(ROOT, process.env.THIRTY_SHOTS_DIR || 'shots');
// dSF 3 is the iPhone's real ratio; a QA run that commits its PNGs drops to 2 to stay under 300 KB a shot
const SCALE = Number(process.env.THIRTY_SHOTS_SCALE) || 3;
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
// CHROME_PATH pins a browser (the build VM needed one); with it unset Playwright resolves the Chromium
// it installed itself, so the script runs on any machine with `npx playwright install chromium`.
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const results = [];
for (const s of sizes) {
  const ctx = await browser.newContext({
    ...devices['iPhone 13'],
    viewport: { width: s.width, height: s.height },
    deviceScaleFactor: SCALE,
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
  const cards = page.locator('.card[data-id]:not([data-id="done"])');
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
  // snapshot: the offline check below deliberately disconnects the network, and a live reference would
  // backdate its ERR_INTERNET_DISCONNECTED into this viewport's clean run
  results.push({ size: s.name, cards: n, strip, progress, titles, doneCard: done === 1, errors: [...errors] });

  if (s.name === '390x844') {
    // installability, by hand: Lighthouse dropped its PWA category in v12, so each bit is asserted here
    const man = await (await page.request.get(base + '/manifest.webmanifest')).json();
    const dom = await page.evaluate(() => {
      const deck = document.querySelector('.deck');
      const card = document.querySelector('.card[data-id]');
      let storage = 'unavailable';
      try { const k = 'thirty:probe'; localStorage.setItem(k, '1'); localStorage.removeItem(k); storage = 'writable'; } catch { storage = 'threw (handled)'; }
      return {
        appleTouchIcon: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href') || null,
        manifestLink: document.querySelector('link[rel="manifest"]')?.getAttribute('href') || null,
        appleCapable: document.querySelector('meta[name="apple-mobile-web-app-capable"]')?.content || null,
        snapType: deck && getComputedStyle(deck).scrollSnapType,
        snapAlign: card && getComputedStyle(card).scrollSnapAlign,
        snapStop: card && getComputedStyle(card).scrollSnapStop,
        storage,
        stored: (() => { try { return !!localStorage.getItem('thirty:v1'); } catch { return false; } })(),
      };
    });
    const swState = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return 'unsupported';
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return 'not registered';
      return reg.active ? 'active' : reg.installing ? 'installing' : reg.waiting ? 'waiting' : 'registered';
    });
    results.push({
      check: 'installability',
      manifestDisplay: man.display, manifestOrientation: man.orientation, manifestIcons: (man.icons || []).length,
      manifestStartUrl: man.start_url, manifestScope: man.scope,
      ...dom, serviceWorker: swState, consoleErrors: errors.length,
    });

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
      offlineCards = await page.locator('.card[data-id]:not([data-id="done"])').count();
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

    // seen/mute round-trip through localStorage, in this throwaway context so the deck above is untouched
    if (installShown) await p2.click('#install-dismiss');
    await p2.waitForSelector('.card[data-id]');
    const before = await p2.locator('.card[data-id]:not([data-id="done"])').count();
    await p2.locator('.card[data-id] .btn', { hasText: 'Mute' }).first().click();
    await p2.waitForTimeout(300);
    const persisted = await p2.evaluate(() => { try { return JSON.parse(localStorage.getItem('thirty:v1') || '{}'); } catch { return null; } });
    await p2.reload({ waitUntil: 'networkidle' });
    await p2.waitForSelector('.card[data-id]');
    results.push({
      check: 'mute-persists-across-reload',
      mutedKeys: Object.keys(persisted?.muted || {}).length,
      seenKeys: Object.keys(persisted?.seen || {}).length,
      cardsBefore: before,
      cardsAfterReload: await p2.locator('.card[data-id]:not([data-id="done"])').count(),
    });
    await ios.close();
  }
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(results, null, 1));
