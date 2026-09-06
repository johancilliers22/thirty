import './style.css';

// ---------- constants ----------
const SESSION_SIZE = 30;          // THIRTY: a finite session, then a stop
const MAX_IN_A_ROW = 2;           // diversity: no source more than 2 cards in a row
const MAX_SHARE = 0.4;            // diversity: no source more than 40% of the session
const MUTE_DAYS = 7;
const SEEN_TTL_DAYS = 14;
const STALE_HOURS = 14;           // strip turns amber past this (a missed twice-daily run)
const LONG_PRESS_MS = 550;
const STORE_KEY = 'thirty:v1';

// ---------- storage (localStorage, every access in try/catch: Safari can throw or evict) ----------
const defaults = () => ({ seen: {}, muted: {}, less: {}, hidden: {}, installDismissedAt: 0, persistAsked: false });
let state = defaults();
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) state = { ...defaults(), ...JSON.parse(raw) };
  } catch { state = defaults(); }
  // prune old seen entries
  const cutoff = Date.now() - SEEN_TTL_DAYS * 864e5;
  for (const [id, t] of Object.entries(state.seen)) if (t < cutoff) delete state.seen[id];
  for (const [src, until] of Object.entries(state.muted)) if (until < Date.now()) delete state.muted[src];
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* storage full or unavailable: keep going in memory */ }
}

// ---------- dom helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, attrs = {}, ...children) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k.startsWith('data-')) n.setAttribute(k, v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children) if (c != null) n.append(c);
  return n;
};
const deck = $('#deck');
const builtEl = $('#built');
const stripEl = $('#strip');
const progressEl = $('#progress');
const toastEl = $('#toast');
const bannerEl = $('#banner');

let toastTimer;
function toast(msg, { action, onAction, ms = 4500 } = {}) {
  toastEl.replaceChildren(el('span', { text: msg }));
  if (action) toastEl.append(el('button', { type: 'button', text: action, onclick: () => { onAction?.(); hideToast(); } }));
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, ms);
}
function hideToast() { toastEl.hidden = true; }
function banner(msg, onTap) {
  bannerEl.replaceChildren(el('span', { text: msg }), el('button', { type: 'button', text: 'Refresh' }));
  bannerEl.onclick = () => { bannerEl.hidden = true; onTap(); };
  bannerEl.hidden = false;
}

// ---------- time ----------
const hoursAgo = (iso) => Math.max(0, (Date.now() - Date.parse(iso)) / 36e5);
function ageLabel(iso) {
  const h = hoursAgo(iso);
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min ago`;
  if (h < 48) return `${Math.round(h)} h ago`;
  return `${Math.round(h / 24)} d ago`;
}
function builtLabel(iso) {
  const h = hoursAgo(iso);
  if (h < 1) return 'built just now';
  if (h < 48) return `built ${Math.round(h)} hour${Math.round(h) === 1 ? '' : 's'} ago`;
  return `built ${Math.round(h / 24)} days ago`;
}

// ---------- feed ----------
let feed = null;
let session = [];
const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) && !window.MSStream;

async function loadFeed({ bust = false } = {}) {
  const res = await fetch('/feed.json', bust ? { cache: 'reload' } : {});
  if (!res.ok) throw new Error(`feed ${res.status}`);
  return res.json();
}

// Diversity re-rank: highest score first, but no source more than MAX_IN_A_ROW consecutively and
// no source more than MAX_SHARE of the session. "Less like this" nudges lower a source's effective score.
function buildSession(items) {
  const now = Date.now();
  const pool = items
    .filter((it) => !state.hidden[it.id])
    .filter((it) => !(state.muted[it.source] > now))
    .filter((it) => !state.seen[it.id])
    .map((it) => ({ ...it, eff: it.score - Math.min(3, (state.less[it.source] || 0) * 0.5) }))
    .sort((a, b) => b.eff - a.eff || Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  const picks = [];
  const counts = {};
  const cap = Math.ceil(SESSION_SIZE * MAX_SHARE);
  const deferred = [];
  for (const it of pool) {
    if (picks.length >= SESSION_SIZE) break;
    const last = picks.slice(-MAX_IN_A_ROW);
    const inARow = last.length === MAX_IN_A_ROW && last.every((p) => p.source === it.source);
    if (inARow || (counts[it.source] || 0) >= cap) { deferred.push(it); continue; }
    picks.push(it); counts[it.source] = (counts[it.source] || 0) + 1;
    // a deferred item may now fit (the run was broken)
    for (let i = 0; i < deferred.length && picks.length < SESSION_SIZE; i++) {
      const d = deferred[i];
      const l2 = picks.slice(-MAX_IN_A_ROW);
      const run2 = l2.length === MAX_IN_A_ROW && l2.every((p) => p.source === d.source);
      if (!run2 && (counts[d.source] || 0) < cap && d.eff >= it.eff) { picks.push(d); counts[d.source] = (counts[d.source] || 0) + 1; deferred.splice(i, 1); i--; }
    }
  }
  return picks;
}

const bandOf = (s) => (s >= 7 ? 'high' : s >= 4 ? 'mid' : 'low');
const openUrl = (url) => { const w = window.open(url, '_blank', 'noopener'); if (!w) location.href = url; };

function renderCard(it, index) {
  const primaryUrl = it.linkUrl || it.url;
  const media = renderMedia(it);
  const body = el('div', { class: 'card-body' },
    el('div', { class: 'card-top' },
      el('span', { class: 'chip', 'data-source': it.source }, el('i', { class: 'chip-dot', 'aria-hidden': 'true' }), el('span', { text: it.sourceName })),
      el('span', { class: 'age', text: ageLabel(it.publishedAt) }),
      el('span', { class: 'score', 'data-band': bandOf(it.score), text: `${it.score}/10`, 'aria-label': `Score ${it.score} out of 10` }),
    ),
    media,
    el('h2', { class: 'title', text: it.title }),
    it.excerpt && it.kind !== 'video' ? el('p', { class: 'excerpt', text: it.excerpt }) : null,
    el('p', { class: 'byline', text: [it.author, it.domain && it.domain !== 'bsky.app' ? it.domain : null].filter(Boolean).join(' · ') }),
    el('p', { class: 'reason' }, el('b', { text: 'Why: ' }), document.createTextNode(it.reason || '')),
    el('div', { class: 'actions' },
      el('a', { class: 'btn primary', href: primaryUrl, target: '_blank', rel: 'noopener noreferrer', text: it.kind === 'video' ? 'Watch on YouTube' : 'Open' }),
      it.discussionUrl && it.discussionUrl !== primaryUrl ? el('a', { class: 'btn quiet', href: it.discussionUrl, target: '_blank', rel: 'noopener noreferrer', text: it.source === 'bluesky' ? 'Post' : 'Comments' }) : null,
      el('button', { class: 'btn quiet', type: 'button', text: 'Less like this', onclick: (e) => { e.stopPropagation(); lessLikeThis(it); } }),
      el('button', { class: 'btn quiet', type: 'button', text: 'Mute', 'aria-label': `Mute ${it.sourceName} for 7 days`, onclick: (e) => { e.stopPropagation(); muteSource(it); } }),
    ),
  );
  const card = el('section', { class: 'card', 'data-id': it.id, 'data-source': it.source, 'aria-label': `Card ${index + 1} of ${session.length}` }, body,
    el('p', { class: 'hint', text: index === 0 ? 'Tap to open · swipe up for next · hold to mute the source' : '' }));

  // tap anywhere on the card body opens the source (buttons/links inside handle themselves)
  body.addEventListener('click', (e) => {
    if (e.target.closest('a, button, iframe')) return;
    if (body.dataset.longPressed) { delete body.dataset.longPressed; return; }
    openUrl(primaryUrl);
  });
  attachLongPress(body, () => { body.dataset.longPressed = '1'; muteSource(it); });
  body.addEventListener('contextmenu', (e) => e.preventDefault());
  return card;
}

function renderMedia(it) {
  if (it.kind === 'video' && it.videoId) {
    const wrap = el('div', { class: 'media' },
      el('img', { src: it.thumbnail, alt: '', width: 480, height: 360, loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', onerror: (e) => { e.target.remove(); wrap.classList.add('no-thumb'); wrap.prepend(el('span', { text: 'Video · thumbnail unavailable' })); } }),
      el('button', { class: 'play', type: 'button', 'aria-label': `Play ${it.title}` }, el('span', { text: '▶', 'aria-hidden': 'true' })),
    );
    wrap.querySelector('.play').addEventListener('click', (e) => {
      e.stopPropagation();
      // tap-to-play; the user gesture makes muted inline autoplay a progressive enhancement, never a default
      const src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(it.videoId)}?autoplay=1&mute=1&playsinline=1&rel=0&modestbranding=1`;
      wrap.replaceChildren(el('iframe', { src, title: it.title, allow: 'autoplay; encrypted-media; picture-in-picture', allowfullscreen: true, loading: 'eager' }));
    });
    return wrap;
  }
  if (it.thumbnail) {
    const wrap = el('div', { class: 'media' });
    wrap.append(el('img', { src: it.thumbnail, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', onerror: () => wrap.remove() }));
    return wrap;
  }
  return null;
}

function attachLongPress(node, fn) {
  let timer = null, sx = 0, sy = 0;
  const cancel = () => { clearTimeout(timer); timer = null; };
  node.addEventListener('pointerdown', (e) => {
    if (e.target.closest('a, button, iframe')) return;
    sx = e.clientX; sy = e.clientY;
    cancel();
    timer = setTimeout(() => { timer = null; fn(); }, LONG_PRESS_MS);
  });
  node.addEventListener('pointermove', (e) => { if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) cancel(); });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) node.addEventListener(ev, cancel);
}

function renderDone(shown, total) {
  const built = feed ? builtLabel(feed.builtAt) : '';
  const msg = shown === 0
    ? 'Nothing new since the last build.'
    : shown < SESSION_SIZE ? `That's everything new: ${shown} card${shown === 1 ? '' : 's'}.` : "That's thirty.";
  return el('section', { class: 'card card-done', 'aria-label': 'End of session' },
    el('div', { class: 'card-body' },
      el('div', { class: 'ring', text: String(shown) }),
      el('h2', { text: shown === 0 ? 'All caught up' : "You're done" }),
      el('p', { text: msg }),
      el('p', { text: `Nothing more loads. The next build replaces these cards. This one was ${built}.` }),
      el('div', { class: 'row' },
        el('button', { class: 'btn', type: 'button', text: 'Start over', onclick: () => { state.seen = {}; save(); render(); deck.scrollTo({ top: 0 }); } }),
      ),
    ));
}

function render() {
  if (!feed) return;
  session = buildSession(feed.items);
  deck.replaceChildren(...session.map(renderCard), renderDone(session.length, feed.items.length));
  observeSeen();
  updateProgress(0);
}

let seenObserver;
function observeSeen() {
  seenObserver?.disconnect();
  const timers = new Map();
  seenObserver = new IntersectionObserver((entries) => {
    for (const en of entries) {
      const id = en.target.dataset.id;
      if (!id) continue;
      if (en.intersectionRatio >= 0.6) {
        if (!timers.has(id)) timers.set(id, setTimeout(() => { if (!state.seen[id]) { state.seen[id] = Date.now(); save(); } }, 1500));
        updateProgress(session.findIndex((s) => s.id === id));
      } else { clearTimeout(timers.get(id)); timers.delete(id); }
    }
  }, { root: deck, threshold: [0.6] });
  for (const c of deck.querySelectorAll('.card[data-id]')) seenObserver.observe(c);
}
function updateProgress(i) {
  progressEl.textContent = session.length ? `${Math.min(session.length, Math.max(0, i) + 1)} / ${session.length}` : '';
}

function muteSource(it) {
  state.muted[it.source] = Date.now() + MUTE_DAYS * 864e5; save();
  const removed = session.filter((s) => s.source === it.source).length;
  toast(`${it.sourceName} muted for 7 days (${removed} card${removed === 1 ? '' : 's'} hidden)`, {
    action: 'Undo', onAction: () => { delete state.muted[it.source]; save(); render(); },
  });
  render();
}
function lessLikeThis(it) {
  state.hidden[it.id] = Date.now();
  state.less[it.source] = (state.less[it.source] || 0) + 1; save();
  toast(`Hidden. ${it.sourceName} nudged down by ${Math.min(3, state.less[it.source] * 0.5)} point${state.less[it.source] * 0.5 === 1 ? '' : 's'} on this phone.`, {
    action: 'Undo', onAction: () => { delete state.hidden[it.id]; state.less[it.source] = Math.max(0, (state.less[it.source] || 1) - 1); save(); render(); },
  });
  render();
}

function updateStrip() {
  if (!feed) return;
  const h = hoursAgo(feed.builtAt);
  builtEl.textContent = builtLabel(feed.builtAt) + (navigator.onLine === false ? ' · offline copy' : '');
  stripEl.classList.toggle('stale', h > STALE_HOURS);
  builtEl.title = new Date(feed.builtAt).toLocaleString();
}

// ---------- settings sheet ----------
const settings = $('#settings');
const install = $('#install');
function renderSettings() {
  $('#settings-build').textContent = feed
    ? `${feed.items.length} candidates ranked, ${builtLabel(feed.builtAt)} (${new Date(feed.builtAt).toLocaleString()}). Sources this build: ${Object.entries(feed.counts || {}).map(([k, v]) => `${k} ${v}`).join(', ')}.`
    : 'No feed loaded.';
  const list = $('#mutes');
  const entries = Object.entries(state.muted);
  list.replaceChildren(...(entries.length ? entries.map(([src, until]) =>
    el('li', {}, el('span', { text: `${sourceLabel(src)} until ${new Date(until).toLocaleDateString()}` }),
      el('button', { class: 'btn', type: 'button', text: 'Unmute', onclick: () => { delete state.muted[src]; save(); renderSettings(); render(); } }))
  ) : [el('li', { class: 'fine', text: 'Nothing muted.' })]));
  const less = Object.entries(state.less).filter(([, n]) => n > 0);
  $('#lessinfo').textContent = less.length
    ? `Nudges on this phone: ${less.map(([s, n]) => `${sourceLabel(s)} −${Math.min(3, n * 0.5)}`).join(', ')}. ${Object.keys(state.hidden).length} card(s) hidden.`
    : 'Tap “Less like this” on a card to hide it and nudge its source down by half a point (max 3). Stored only on this phone, inspectable here, clearable below.';
  $('#interests').textContent = feed?.interests || 'interests.md is not in this build.';
}
function sourceLabel(src) {
  return feed?.items.find((i) => i.source === src)?.sourceName || { hn: 'Hacker News', lobsters: 'lobste.rs', bluesky: 'Bluesky', youtube: 'YouTube', huggingface: 'Hugging Face' }[src] || src;
}
$('#settings-btn').addEventListener('click', () => { renderSettings(); settings.showModal(); });
$('#settings-close').addEventListener('click', () => settings.close());
settings.addEventListener('click', (e) => { if (e.target === settings) settings.close(); });
install.addEventListener('click', (e) => { if (e.target === install) install.close(); });
$('#btn-refresh').addEventListener('click', async () => { settings.close(); await refresh({ bust: true }); });
$('#btn-reset-seen').addEventListener('click', () => { state.seen = {}; state.hidden = {}; save(); settings.close(); render(); deck.scrollTo({ top: 0 }); });
$('#btn-clear-less').addEventListener('click', () => { state.less = {}; state.hidden = {}; save(); renderSettings(); render(); });
$('#btn-install-help').addEventListener('click', () => { settings.close(); install.showModal(); });
$('#install-dismiss').addEventListener('click', () => { state.installDismissedAt = Date.now(); save(); install.close(); });
$('#btn-copy-interests').addEventListener('click', async (e) => {
  const text = $('#interests').textContent;
  try { await navigator.clipboard.writeText(text); toast('Interests copied'); }
  catch {
    const r = document.createRange(); r.selectNodeContents($('#interests'));
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    toast('Select-all is done, tap Copy in the menu');
  }
});

// export / import of local state (mutes, seen, nudges) as JSON, via the share sheet when files can be shared
$('#btn-export').addEventListener('click', async () => {
  const payload = { app: 'thirty', version: 1, exportedAt: new Date().toISOString(), state, interests: feed?.interests || null };
  const json = JSON.stringify(payload, null, 1);
  const file = new File([json], `thirty-backup-${new Date().toISOString().slice(0, 10)}.json`, { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: 'THIRTY backup' }); return; }
  } catch (err) { if (err?.name === 'AbortError') return; }
  const a = el('a', { href: URL.createObjectURL(file), download: file.name });
  document.body.append(a); a.click(); a.remove();
  const ta = $('#export-text'); ta.value = json; ta.hidden = false;
  toast('Backup ready: saved as a file, and shown below to copy');
});
$('#import-file').addEventListener('change', async (e) => {
  const f = e.target.files?.[0]; if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const s = data?.state;
    if (!s || typeof s !== 'object' || data.app !== 'thirty') throw new Error('not a THIRTY backup');
    state = { ...defaults(), ...s, seen: { ...s.seen }, muted: { ...s.muted }, less: { ...s.less }, hidden: { ...s.hidden } };
    save(); load(); renderSettings(); render();
    toast('Backup imported');
  } catch (err) { toast(`Import failed: ${err.message}`); }
  e.target.value = '';
});

// ---------- service worker: precached shell, stale-while-revalidate feed, "new build" banner ----------
let wantReload = false; // only reload on controllerchange after the user accepted an update, never on first install
async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    const promptUpdate = (worker) => banner('New version of THIRTY', () => { wantReload = true; worker.postMessage({ type: 'SKIP_WAITING' }); });
    if (reg.waiting && navigator.serviceWorker.controller) promptUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) promptUpdate(w); });
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!wantReload) return; wantReload = false; location.reload(); });
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type === 'feed-updated' && feed && e.data.builtAt !== feed.builtAt) banner('New cards are ready', () => refresh());
    });
  } catch { /* no SW: the app still works online */ }
}

async function refresh({ bust = false } = {}) {
  try {
    const next = await loadFeed({ bust });
    feed = next; render(); updateStrip(); deck.scrollTo({ top: 0 });
  } catch (err) { toast(`Could not reload: ${err.message}`); }
}

// ---------- boot ----------
async function boot() {
  load();
  try {
    feed = await loadFeed();
  } catch (err) {
    deck.replaceChildren(el('section', { class: 'card card-done' }, el('div', { class: 'card-body' },
      el('h2', { text: 'No feed yet' }), el('p', { text: `Could not load feed.json (${err.message}). If you are offline, the last build appears once it has been cached.` }))));
    builtEl.textContent = 'no feed';
    registerSW();
    return;
  }
  render();
  updateStrip();
  setInterval(updateStrip, 60_000);
  window.addEventListener('online', updateStrip);
  window.addEventListener('offline', updateStrip);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) updateStrip(); });
  registerSW();

  // ask once for durable storage; WebKit weighs "opened as a Home Screen web app" in its heuristic
  if (!state.persistAsked && navigator.storage?.persist) {
    state.persistAsked = true; save();
    navigator.storage.persist().catch(() => {});
  }
  // first-time Safari visitors on iPhone get the install screen; never inside the installed app
  if (isIOS() && !isStandalone() && Date.now() - (state.installDismissedAt || 0) > 7 * 864e5) {
    install.showModal();
  }
}
boot();
