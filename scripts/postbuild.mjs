// Stamps the service worker with a build id after `vite build`, so every deploy ships a byte-different
// sw.js (=> updatefound => "New version" banner in the app). Also copies interests text into the built
// feed if the feed builder has not already done so.
import { readFile, writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sw = path.join(ROOT, 'dist', 'sw.js');
let id = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
try { id += '-' + execSync('git rev-parse --short HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* no git */ }
const src = await readFile(sw, 'utf8');
if (!src.includes('__BUILD_ID__')) throw new Error('dist/sw.js has no __BUILD_ID__ placeholder');
await writeFile(sw, src.replaceAll('__BUILD_ID__', id));
console.log(`sw.js stamped with build ${id}`);
