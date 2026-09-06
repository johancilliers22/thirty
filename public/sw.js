/* THIRTY service worker. Hand-written, no build-time precache manifest: on install it fetches
   index.html and precaches every /assets, /icons and manifest URL it references, so Vite's hashed
   filenames never go stale. __BUILD_ID__ is stamped by scripts/postbuild.mjs so each deploy is a
   new worker (byte-different file => updatefound => "New version" banner). */
const BUILD_ID = '__BUILD_ID__';
const SHELL = `thirty-shell-${BUILD_ID}`;
const FEED = 'thirty-feed';
const MEDIA = 'thirty-media';
const MEDIA_MAX = 90;
const MEDIA_HOSTS = ['i.ytimg.com', 'i1.ytimg.com', 'i2.ytimg.com', 'i3.ytimg.com', 'i4.ytimg.com', 'cdn.bsky.app'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    const res = await fetch('/index.html', { cache: 'reload' });
    if (!res.ok) throw new Error(`index ${res.status}`);
    const html = await res.text();
    const urls = new Set(['/', '/index.html', '/manifest.webmanifest']);
    for (const m of html.matchAll(/(?:src|href)="(\/(?:assets|icons)\/[^"]+|\/manifest\.webmanifest)"/g)) urls.add(m[1]);
    await cache.put('/index.html', new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } }));
    await cache.put('/', new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } }));
    await Promise.all([...urls].filter((u) => u !== '/' && u !== '/index.html').map(async (u) => {
      try { const r = await fetch(u, { cache: 'reload' }); if (r.ok) await cache.put(u, r); } catch { /* optional asset */ }
    }));
    // the first page load fetched feed.json before this worker controlled it, so seed the feed cache here
    try {
      const feedCache = await caches.open(FEED);
      if (!(await feedCache.match('/feed.json'))) { const r = await fetch('/feed.json', { cache: 'no-cache' }); if (r.ok) await feedCache.put('/feed.json', r); }
    } catch { /* offline install: the next online load fills it */ }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('thirty-shell-') && key !== SHELL) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(k);
}

async function broadcast(msg) {
  for (const c of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) c.postMessage(msg);
}

// stale-while-revalidate for feed.json: cached copy now, network copy for next time, and a message when it changed
async function feedSWR(request) {
  const cache = await caches.open(FEED);
  const cached = await cache.match('/feed.json');
  const network = fetch(request, { cache: 'no-cache' }).then(async (res) => {
    if (!res.ok) return res;
    const fresh = res.clone();
    const [oldText, newText] = await Promise.all([cached ? cached.clone().text() : Promise.resolve(''), fresh.text()]);
    await cache.put('/feed.json', res.clone());
    const builtAt = (newText.match(/"builtAt":"([^"]+)"/) || [])[1];
    const oldBuilt = (oldText.match(/"builtAt":"([^"]+)"/) || [])[1];
    if (cached && builtAt && builtAt !== oldBuilt) broadcast({ type: 'feed-updated', builtAt });
    return res;
  }).catch(() => null);
  if (cached) { network.catch(() => {}); return cached; }
  const res = await network;
  return res || new Response(JSON.stringify({ error: 'offline', items: [] }), { status: 503, headers: { 'content-type': 'application/json' } });
}

async function cacheFirst(request, cacheName, { max } = {}) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request, { ignoreVary: true });
  if (hit) return hit;
  try {
    const res = await fetch(request);
    if (res.ok || res.type === 'opaque') { await cache.put(request, res.clone()); if (max) trim(cacheName, max); }
    return res;
  } catch {
    return new Response('', { status: 504, statusText: 'offline' });
  }
}

async function navigate(request) {
  try {
    const res = await fetch(request);
    if (res.ok) { const cache = await caches.open(SHELL); cache.put('/index.html', res.clone()); }
    return res;
  } catch {
    const cache = await caches.open(SHELL);
    return (await cache.match('/index.html')) || new Response('<h1>THIRTY is offline</h1><p>Open it again when you have a connection.</p>', { status: 503, headers: { 'content-type': 'text/html' } });
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (request.mode === 'navigate') { event.respondWith(navigate(request)); return; }
  if (url.origin === self.location.origin) {
    if (url.pathname === '/feed.json') { event.respondWith(feedSWR(request)); return; }
    if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest') {
      event.respondWith(cacheFirst(request, SHELL)); return;
    }
    return;
  }
  if (MEDIA_HOSTS.includes(url.hostname) && request.destination === 'image') {
    event.respondWith(cacheFirst(request, MEDIA, { max: MEDIA_MAX }));
  }
});
