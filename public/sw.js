/* THIRTY service worker. Hand-written, no build-time precache manifest: on install it fetches
   index.html and the manifest and precaches every /assets, /icons and manifest URL they reference, so
   Vite's hashed filenames never go stale. __BUILD_ID__ is stamped by scripts/postbuild.mjs so each deploy
   is a new worker (byte-different file => updatefound => "New version" banner). */
const BUILD_ID = '__BUILD_ID__';
const SHELL = `thirty-shell-${BUILD_ID}`;
const FEED = 'thirty-feed';
const MEDIA = 'thirty-media';
const MEDIA_MAX = 60;
const NAV_TIMEOUT_MS = 3000;
const MEDIA_HOSTS = ['i.ytimg.com', 'i1.ytimg.com', 'i2.ytimg.com', 'i3.ytimg.com', 'i4.ytimg.com', 'cdn.bsky.app'];

const builtAtOf = (text) => Date.parse((text.match(/"builtAt":"([^"]+)"/) || [])[1] || '') || 0;
const isFeedJson = (res, text) => (res.headers.get('content-type') || '').includes('json') && text.startsWith('{') && builtAtOf(text) > 0;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    const res = await fetch('/index.html', { cache: 'reload' });
    if (!res.ok) throw new Error(`index ${res.status}`);
    const html = await res.text();
    const urls = new Set(['/manifest.webmanifest']);
    for (const m of html.matchAll(/(?:src|href)="(\/(?:assets|icons)\/[^"]+|\/manifest\.webmanifest)"/g)) urls.add(m[1]);
    const htmlHeaders = { 'content-type': 'text/html; charset=utf-8' };
    await cache.put('/index.html', new Response(html, { headers: htmlHeaders }));
    await cache.put('/', new Response(html, { headers: htmlHeaders }));
    try {
      const man = await fetch('/manifest.webmanifest', { cache: 'reload' });
      if (man.ok) { const j = await man.clone().json(); for (const i of j.icons || []) if (typeof i.src === 'string' && i.src.startsWith('/')) urls.add(i.src); await cache.put('/manifest.webmanifest', man); urls.delete('/manifest.webmanifest'); }
    } catch { /* manifest is optional for offline */ }
    await Promise.all([...urls].map(async (u) => {
      try { const r = await fetch(u, { cache: 'reload' }); if (r.ok) await cache.put(u, r); } catch { /* optional asset */ }
    }));
    // the first page load fetched feed.json before this worker controlled it, so seed the feed cache here
    try {
      const feedCache = await caches.open(FEED);
      if (!(await feedCache.match('/feed.json'))) {
        const r = await fetch('/feed.json', { cache: 'no-cache' });
        const text = r.ok ? await r.clone().text() : '';
        if (r.ok && isFeedJson(r, text)) await feedCache.put('/feed.json', r);
      }
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
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') self.skipWaiting();
  if (data.type === 'warm' && Array.isArray(data.urls)) {
    // the page asks us to keep this session's thumbnails offline; only http(s) on the known image hosts
    const urls = data.urls.filter((u) => { try { const x = new URL(u); return x.protocol === 'https:' && MEDIA_HOSTS.includes(x.hostname); } catch { return false; } }).slice(0, MEDIA_MAX);
    event.waitUntil((async () => {
      const cache = await caches.open(MEDIA);
      for (const u of urls) {
        try {
          if (await cache.match(u)) continue;
          const r = await fetch(u, { mode: 'cors', credentials: 'omit' });
          if (r.ok) await cache.put(u, r);
        } catch { /* keep going */ }
      }
      await trim(MEDIA, MEDIA_MAX);
    })());
  }
});

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(k);
}

async function broadcast(msg) {
  for (const c of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) c.postMessage(msg);
}

// stale-while-revalidate for feed.json: cached copy now, network copy for next time, and a message when a
// strictly newer build arrived. A request with cache: 'reload' (the Settings "Reload feed" button) goes
// network-first. Only a JSON body with a builtAt newer than the cached one ever replaces the cache, so a
// stale edge, an HTML fallback page or a captive portal can never poison or downgrade the offline copy.
async function feedSWR(event) {
  const { request } = event;
  const cache = await caches.open(FEED);
  const cached = await cache.match('/feed.json');
  const oldBuilt = cached ? builtAtOf(await cached.clone().text()) : 0;
  const network = fetch(request, { cache: 'no-cache' }).then(async (res) => {
    if (!res.ok) return res;
    const text = await res.clone().text();
    if (!isFeedJson(res, text)) return res;
    const builtAt = builtAtOf(text);
    if (builtAt > oldBuilt) {
      await cache.put('/feed.json', res.clone());
      if (cached) broadcast({ type: 'feed-updated', builtAt: new Date(builtAt).toISOString() });
    }
    return res;
  }).catch(() => null);
  event.waitUntil(network.catch(() => {}));
  const wantsNetwork = request.cache === 'reload' || request.cache === 'no-store';
  if (cached && !wantsNetwork) return cached;
  const res = await network;
  if (res && res.ok) return res;
  return cached || new Response(JSON.stringify({ error: 'offline', items: [] }), { status: 503, headers: { 'content-type': 'application/json' } });
}

async function cacheFirst(event, cacheName, { max } = {}) {
  const { request } = event;
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request, { ignoreVary: true });
  if (hit) return hit;
  try {
    const res = await fetch(request);
    if (res.ok) { // opaque responses are never cached: a 404 would be indistinguishable from a hit
      event.waitUntil((async () => { await cache.put(request, res.clone()); if (max) await trim(cacheName, max); })());
    }
    return res;
  } catch {
    return new Response('', { status: 504, statusText: 'offline' });
  }
}

// navigation: network first with a short timeout, cached shell as the fallback (lie-fi and offline alike)
async function navigate(event) {
  const { request } = event;
  const cache = await caches.open(SHELL);
  const net = fetch(request).then((res) => { if (res.ok) event.waitUntil(cache.put('/index.html', res.clone())); return res; }).catch(() => null);
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NAV_TIMEOUT_MS));
  const res = await Promise.race([net, timeout]);
  if (res && res.ok) return res;
  event.waitUntil(net.catch(() => {}));
  return (await cache.match('/index.html')) || (res) || new Response('<h1>THIRTY is offline</h1><p>Open it again when you have a connection.</p>', { status: 503, headers: { 'content-type': 'text/html' } });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (request.mode === 'navigate') { event.respondWith(navigate(event)); return; }
  if (url.origin === self.location.origin) {
    if (url.pathname === '/feed.json') { event.respondWith(feedSWR(event)); return; }
    if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest') {
      event.respondWith(cacheFirst(event, SHELL)); return;
    }
    return;
  }
  if (MEDIA_HOSTS.includes(url.hostname) && request.destination === 'image') {
    event.respondWith(cacheFirst(event, MEDIA, { max: MEDIA_MAX }));
  }
});
