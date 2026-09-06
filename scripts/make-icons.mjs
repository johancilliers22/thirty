// Renders public/icons/icon.svg to the PNG sizes iOS and the manifest need, using the Chromium that
// Playwright already ships (no ImageMagick in the VM). Run once; the PNGs are committed.
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(ROOT, 'public', 'icons');
const svg = await readFile(path.join(dir, 'icon.svg'), 'utf8');
const outputs = [
  ['apple-touch-icon.png', 180, 1],
  ['icon-192.png', 192, 1],
  ['icon-512.png', 512, 1],
  ['icon-512-maskable.png', 512, 0.78], // content shrunk into the maskable safe zone
];
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();
for (const [name, size, scale] of outputs) {
  await page.setViewportSize({ width: size, height: size });
  const inner = svg.replace('<svg ', `<svg style="width:${size * scale}px;height:${size * scale}px;position:absolute;left:${(size - size * scale) / 2}px;top:${(size - size * scale) / 2}px" `);
  await page.setContent(`<html><body style="margin:0;background:#0f1115;width:${size}px;height:${size}px;overflow:hidden">${inner}</body></html>`);
  await page.screenshot({ path: path.join(dir, name), clip: { x: 0, y: 0, width: size, height: size }, omitBackground: false });
  console.log('wrote', name);
}
await browser.close();
