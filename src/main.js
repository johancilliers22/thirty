import './style.css';

// ---------- constants ----------
const DEFAULT_SESSION_SIZE = 30; // THIRTY: a finite session, then a stop (feed.json may override)
const MAX_IN_A_ROW = 2;          // diversity: no source more than 2 cards in a row
const MAX_SHARE = 0.4;           // diversity: no source more than 40% of the session
const MUTE_DAYS = 7;
const SEEN_TTL_DAYS = 14;
const HIDDEN_TTL_DAYS = 30;
const STALE_HOURS = 14;          // strip turns amber past this (a missed twice-daily run)
const LONG_PRESS_MS = 550;
const STORE_KEY = 'thirty:v1';

// ---------- storage (localStorage, every access in try/catch: Safari can throw or evict) ----------
// muted: { [muteKey]: { until, name } }   muteKey = channelId for YouTube, otherwise the source id
// seen/hidden: { [itemId]: timestamp }     less: { [source]: count }
const defaults = () => ({ seen: {}, muted: {}, less: {}, hidden: {}, installDismissedAt: 0, persistAsked: false });
let state = defaults();
const isMap = (v) => v && typeof v === 'object' && !Array.isArray(v);
function normaliseState(raw) {
  const s = { ...defaults(), ...(isMap(raw) ? raw : {}) };
  for (const k of ['seen', 'muted', 'less', 'hidden']) if (!isMap(s[k])) s[k] = {};
  s.seen = Object.fromEntries(Object.entries(s.seen).filter(([, t]) => Number.isFinite(t)));
  s.hidden = Object.fromEntries(Object.entries(s.hidden).filter(([, t]) => Number.isFinite(t)));
  s.less = Object.fromEntries(Object.entries(s.less).filter(([, n]) => Number.isFinite(n) && n > 0));
  s.muted = Object.fromEntries(Object.entries(s.muted).map(([k, v]) => [k, typeof v === 'number' ? { until: v, name: k } : v]).filter(([, v]) => isMap(v) && Number.isFinite(v.until)));
  s.installDismissedAt = Number.isFinite(s.installDismissedAt) ? s.installDismissedAt : 0;
  s.persistAsked = !!s.persistAsked;
  return s;
}
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    state = normaliseState(raw ? JSON.parse(raw) : null);
  } catch { state = defaults(); }
  const now = Date.now();
  for (const [id, t] of Object.entries(state.seen)) if (t < now - SEEN_TTL_DAYS * 864e5) delete state.seen[id];
  for (const [id, t] of Object.entries(state.hidden)) if (t < now - HIDDEN_TTL_DAYS * 864e5) delete state.hidden[id];
  for (const [k, m] of Object.entries(state.muted)) if (m.until < now) delete state.muted[k];
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); return true; } catch { return false; /* storage full or unavailable: keep going in memory */ }
}

// ---------- dom helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, attrs = {}, ...children) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
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
const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };

let toastTimer;
function toast(msg, { action, onAction, ms = 5000 } = {}) {
  toastEl.replaceChildren(el('span', { text: msg }));
  if (action) toastEl.append(el('button', { type: 'button', text: action, onclick: () => { onAction?.(); hideToast(); } }));
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, ms);
}
function hideToast() { toastEl.hidden = true; }

// One banner slot. A waiting worker and a newer feed can arrive together after a deploy; the tap does both.
const pending = { worker: null, feed: false };
let wantReload = false; // only reload on controllerchange after the user accepted an update, never on first install
function showBanner() {
  const msg = pending.worker && pending.feed ? 'New version and new cards' : pending.worker ? 'New version of THIRTY' : 'New cards are ready';
  bannerEl.replaceChildren(el('span', { text: msg }), el('button', { type: 'button', text: 'Refresh' }));
  bannerEl.onclick = () => {
    bannerEl.hidden = true;
    if (pending.worker) { wantReload = true; pending.worker.postMessage({ type: 'SKIP_WAITING' }); pending.worker = null; pending.feed = false; return; }
    if (pending.feed) { pending.feed = false; refresh(); }
  };
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
let heldBack = 0;          // higher-scored items the diversity cap kept out of this session
let leftOut = 0;           // lower-scored items that simply did not make the cut
let filteredOut = 0;       // items removed by mutes and "less like this"
let currentIndex = 0;
let interacted = false;
let suppressClickUntil = 0;
document.addEventListener('pointerdown', () => { interacted = true; }, { once: true, passive: true });
const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const sessionSize = () => Number.isInteger(feed?.sessionSize) && feed.sessionSize > 0 ? feed.sessionSize : DEFAULT_SESSION_SIZE;
const muteKey = (it) => it.channelId || it.source;

async function loadFeed({ bust = false } = {}) {
  const res = await fetch('/feed.json', bust ? { cache: 'reload' } : {});
  if (!res.ok) throw new Error(`feed ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data?.items)) throw new Error('feed has no items');
  return data;
}

// Diversity re-rank: highest score first, but no source more than MAX_IN_A_ROW consecutively and
// no source more than MAX_SHARE of the session. "Less like this" nudges lower a source's effective score.
function buildSession(items) {
  const now = Date.now();
  const size = sessionSize();
  const eligible = items.filter((it) => !state.hidden[it.id] && !(state.muted[muteKey(it)]?.until > now));
  filteredOut = items.length - eligible.length;
  const pool = eligible
    .filter((it) => !state.seen[it.id])
    .map((it) => ({ ...it, eff: it.score - Math.min(3, (state.less[it.source] || 0) * 0.5) }))
    .sort((a, b) => b.eff - a.eff || Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  const picks = [];
  const counts = {};
  const cap = Math.ceil(size * MAX_SHARE);
  const deferred = [];
  const fits = (it) => { const last = picks.slice(-MAX_IN_A_ROW); return !(last.length === MAX_IN_A_ROW && last.every((p) => p.source === it.source)) && (counts[it.source] || 0) < cap; };
  const take = (it) => { picks.push(it); counts[it.source] = (counts[it.source] || 0) + 1; };
  for (const it of pool) {
    if (picks.length >= size) break;
    if (!fits(it)) { deferred.push(it); continue; }
    take(it);
    for (let i = 0; i < deferred.length && picks.length < size; i++) { // a deferred item may now fit (the run was broken)
      if (fits(deferred[i]) && deferred[i].eff >= it.eff) { take(deferred[i]); deferred.splice(i, 1); i--; }
    }
  }
  // held back = would have made the cut on score alone, but the source caps displaced it
  const floor = picks.length ? Math.min(...picks.map((p) => p.eff)) : -Infinity;
  heldBack = deferred.filter((d) => d.eff > floor).length;
  leftOut = Math.max(0, pool.length - picks.length - heldBack);
  return picks;
}

const bandOf = (s) => (s >= 7 ? 'high' : s >= 4 ? 'mid' : 'low');
// feed URLs are third-party text: only http(s) ever reaches an href, an <img> or window.open
// nullish first: `new URL(undefined, base)` does not throw, it resolves to "<origin>/undefined", which is
// https and would sail through the protocol check as a real link. Most items carry no linkUrl at all.
const safeUrl = (u) => { if (typeof u !== 'string' || !u) return null; try { const p = new URL(u, location.href); return p.protocol === 'https:' || p.protocol === 'http:' ? p.href : null; } catch { return null; } };
function openUrl(url) {
  const u = safeUrl(url);
  if (!u) return;
  // no 'noopener' feature here: with it, window.open returns null by spec and we could not tell a blocked
  // popup from success, which would navigate the standalone app away. Sever the opener by hand instead.
  const w = window.open(u, '_blank');
  if (w) { try { w.opener = null; } catch { /* cross-origin */ } } else { location.href = u; }
}

function renderCard(it, index) {
  const primaryUrl = safeUrl(it.linkUrl) || safeUrl(it.url);
  const discussionUrl = safeUrl(it.discussionUrl);
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
      primaryUrl ? el('a', { class: 'btn primary', href: primaryUrl, target: '_blank', rel: 'noopener noreferrer', text: it.kind === 'video' ? 'Watch on YouTube' : 'Open' }) : null,
      discussionUrl && discussionUrl !== primaryUrl ? el('a', { class: 'btn quiet', href: discussionUrl, target: '_blank', rel: 'noopener noreferrer', text: it.source === 'bluesky' ? 'Post' : 'Comments' }) : null,
      el('button', { class: 'btn quiet', type: 'button', text: 'Less like this', onclick: (e) => { e.stopPropagation(); lessLikeThis(it); } }),
      el('button', { class: 'btn quiet', type: 'button', text: 'Mute', 'aria-label': `Mute ${it.sourceName} for 7 days`, onclick: (e) => { e.stopPropagation(); muteSource(it); } }),
    ),
  );
  const card = el('section', { class: 'card', 'data-id': it.id, 'aria-label': `Card ${index + 1}: ${it.sourceName}` }, body,
    el('p', { class: 'hint', text: index === 0 ? 'Tap to open · swipe up for next · hold to mute the source' : '' }));

  // tap anywhere on the card body opens the source (buttons/links inside handle themselves)
  body.addEventListener('click', (e) => {
    if (e.target.closest('a, button, iframe')) return;
    if (Date.now() < suppressClickUntil) return; // the synthetic click after a long-press
    if (primaryUrl) openUrl(primaryUrl);
  });
  attachLongPress(body, () => { suppressClickUntil = Date.now() + 800; muteSource(it); });
  body.addEventListener('contextmenu', (e) => e.preventDefault());
  return card;
}

function renderMedia(it) {
  const thumb = safeUrl(it.thumbnail);
  if (it.kind === 'video' && /^[\w-]{6,20}$/.test(it.videoId || '')) {
    const wrap = el('div', { class: 'media' },
      thumb ? el('img', { src: thumb, alt: '', width: 480, height: 360, loading: 'lazy', decoding: 'async', crossorigin: 'anonymous', referrerpolicy: 'no-referrer', onerror: (e) => { e.target.remove(); wrap.classList.add('no-thumb'); wrap.prepend(el('span', { text: 'Video · thumbnail unavailable' })); } }) : el('span', { text: 'Video' }),
      el('button', { class: 'play', type: 'button', 'aria-label': `Play ${it.title}` }, el('span', { text: '▶', 'aria-hidden': 'true' })),
    );
    if (!thumb) wrap.classList.add('no-thumb');
    wrap.querySelector('.play').addEventListener('click', (e) => {
      e.stopPropagation();
      // tap-to-play; the user gesture makes muted inline autoplay a progressive enhancement, never a default
      const src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(it.videoId)}?autoplay=1&mute=1&playsinline=1&rel=0&modestbranding=1`;
      wrap.replaceChildren(el('iframe', { src, title: it.title, allow: 'autoplay; encrypted-media; picture-in-picture', allowfullscreen: true, loading: 'eager' }));
    });
    return wrap;
  }
  if (thumb) {
    const wrap = el('div', { class: 'media' });
    wrap.append(el('img', { src: thumb, alt: '', loading: 'lazy', decoding: 'async', crossorigin: 'anonymous', referrerpolicy: 'no-referrer', onerror: () => wrap.remove() }));
    return wrap;
  }
  return null;
}

// Long-press: the timer only arms the action; it runs when the finger lifts, so the deck never changes under
// a finger that is still down (iOS would otherwise land the synthetic click on whatever card replaced it).
function attachLongPress(node, fn) {
  let timer = null, sx = 0, sy = 0, armed = false;
  const disarm = () => { clearTimeout(timer); timer = null; armed = false; node.classList.remove('held'); };
  node.addEventListener('pointerdown', (e) => {
    if (e.target.closest('a, button, iframe')) return;
    sx = e.clientX; sy = e.clientY;
    disarm();
    timer = setTimeout(() => { timer = null; armed = true; node.classList.add('held'); }, LONG_PRESS_MS);
  });
  node.addEventListener('pointermove', (e) => { if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) disarm(); });
  const finish = () => { const run = armed; disarm(); if (run) fn(); };
  node.addEventListener('pointerup', finish);
  node.addEventListener('pointercancel', finish);
  node.addEventListener('pointerleave', () => { if (!armed) disarm(); });
}

function renderDone(shown) {
  const built = feed ? builtLabel(feed.builtAt) : '';
  const size = sessionSize();
  const mutedCount = Object.keys(state.muted).length;
  let title = "You're done", msg;
  if (shown === 0 && filteredOut > 0 && feed.items.length === filteredOut) { title = 'Everything is muted'; msg = `All ${feed.items.length} cards in this build are hidden by your mutes and nudges.`; }
  else if (shown === 0) { title = 'All caught up'; msg = 'Nothing new since the last build.'; }
  else {
    const head = shown === size ? "That's thirty." : shown < size && !heldBack && !leftOut ? `That's everything new: ${shown} card${shown === 1 ? '' : 's'}.` : `That's ${shown} cards.`;
    const tail = [heldBack ? `${heldBack} higher-scored card${heldBack === 1 ? ' was' : 's were'} held back for source variety` : '', leftOut ? `${leftOut} lower-scored ${leftOut === 1 ? 'one was' : 'ones were'} left out` : ''].filter(Boolean).join('; ');
    msg = tail ? `${head} ${tail}.` : head;
  }
  return el('section', { class: 'card card-done', 'data-id': 'done', 'aria-label': 'End of session' },
    el('div', { class: 'card-body' },
      el('div', { class: 'ring', text: String(shown) }),
      el('h2', { text: title }),
      el('p', { text: msg }),
      el('p', { text: `Nothing more loads. The next build replaces these cards. This one was ${built}.` }),
      el('div', { class: 'row wrap' },
        el('button', { class: 'btn', type: 'button', text: 'Start over', onclick: () => { state.seen = {}; save(); render(); } }),
        mutedCount || Object.keys(state.hidden).length ? el('button', { class: 'btn', type: 'button', text: mutedCount ? `Muted sources (${mutedCount})` : 'Hidden cards', onclick: () => { renderSettings(); settings.showModal(); } }) : null,
      ),
    ));
}

function render() {
  if (!feed) return;
  session = buildSession(feed.items);
  deck.replaceChildren(...session.map(renderCard), renderDone(session.length));
  observeSeen();
  updateProgress(0);
  deck.scrollTo({ top: 0, behavior: 'instant' });
  warmThumbnails();
}
function warmThumbnails() {
  const urls = session.map((s) => safeUrl(s.thumbnail)).filter(Boolean);
  if (!urls.length || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.ready.then((reg) => reg.active?.postMessage({ type: 'warm', urls })).catch(() => {});
}

// Remove cards in place (no rebuild, no scroll jump) and remember them so Undo can put them back.
function removeCards(pred) {
  const anchor = deck.querySelectorAll('.card[data-id]')[currentIndex];
  const removed = [];
  session = session.filter((it, i) => {
    if (!pred(it)) return true;
    const node = deck.querySelector(`.card[data-id="${CSS.escape(it.id)}"]`);
    removed.push({ it, node, index: i });
    node?.remove();
    return false;
  });
  const anchorAlive = anchor && anchor.isConnected ? anchor : deck.querySelectorAll('.card')[Math.min(currentIndex, deck.querySelectorAll('.card').length - 1)];
  anchorAlive?.scrollIntoView({ block: 'start', behavior: 'instant' });
  relabel();
  return removed;
}
function restoreCards(removed) {
  const cards = () => [...deck.querySelectorAll('.card[data-id]')];
  for (const { it, node, index } of removed.sort((a, b) => a.index - b.index)) {
    const all = cards();
    const before = all[index] || deck.querySelector('.card-done');
    deck.insertBefore(node, before);
    session.splice(Math.min(index, session.length), 0, it);
  }
  relabel();
}
function relabel() {
  deck.querySelectorAll('.card[data-id]').forEach((c, i) => { if (c.dataset.id !== 'done') c.setAttribute('aria-label', `Card ${i + 1}: ${session[i]?.sourceName || ''}`); });
  const done = deck.querySelector('.card-done');
  if (done) done.replaceWith(renderDone(session.length));
  observeSeen();
  updateProgress(Math.min(currentIndex, session.length));
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
        if (id === 'done') { updateProgress(session.length); continue; }
        if (!timers.has(id)) timers.set(id, setTimeout(() => { if (!state.seen[id]) { state.seen[id] = Date.now(); save(); } }, 1500));
        updateProgress(session.findIndex((s) => s.id === id));
      } else { clearTimeout(timers.get(id)); timers.delete(id); }
    }
  }, { root: deck, threshold: [0.6] });
  for (const c of deck.querySelectorAll('.card[data-id]')) seenObserver.observe(c);
}
function updateProgress(i) {
  currentIndex = Math.max(0, i);
  setText(progressEl, session.length ? `${Math.min(session.length, currentIndex + 1)} / ${session.length}` : '');
}

function muteSource(it) {
  const key = muteKey(it);
  state.muted[key] = { until: Date.now() + MUTE_DAYS * 864e5, name: it.sourceName }; save();
  const removed = removeCards((s) => muteKey(s) === key);
  toast(`${it.sourceName} muted for 7 days (${removed.length} card${removed.length === 1 ? '' : 's'} hidden)`, {
    action: 'Undo', onAction: () => { delete state.muted[key]; save(); restoreCards(removed); },
  });
}
function lessLikeThis(it) {
  state.hidden[it.id] = Date.now();
  state.less[it.source] = (state.less[it.source] || 0) + 1; save();
  const nudge = Math.min(3, state.less[it.source] * 0.5);
  const removed = removeCards((s) => s.id === it.id);
  toast(`Hidden. ${it.sourceName} nudged down by ${nudge} point${nudge === 1 ? '' : 's'} on this phone.`, {
    action: 'Undo', onAction: () => { delete state.hidden[it.id]; state.less[it.source] = Math.max(0, (state.less[it.source] || 1) - 1); if (!state.less[it.source]) delete state.less[it.source]; save(); restoreCards(removed); },
  });
}

function updateStrip() {
  if (!feed) return;
  const h = hoursAgo(feed.builtAt);
  setText(builtEl, builtLabel(feed.builtAt) + (navigator.onLine === false ? ' · offline copy' : ''));
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
  list.replaceChildren(...(entries.length ? entries.map(([key, m]) =>
    el('li', {}, el('span', { text: `${m.name || key} until ${new Date(m.until).toLocaleDateString()}` }),
      el('button', { class: 'btn', type: 'button', text: 'Unmute', onclick: () => { delete state.muted[key]; save(); renderSettings(); render(); } }))
  ) : [el('li', { class: 'fine', text: 'Nothing muted.' })]));
  const less = Object.entries(state.less).filter(([, n]) => n > 0);
  const hiddenCount = Object.keys(state.hidden).length;
  $('#lessinfo').textContent = less.length || hiddenCount
    ? `Nudges on this phone: ${less.map(([s, n]) => `${sourceLabel(s)} −${Math.min(3, n * 0.5)}`).join(', ') || 'none'}. ${hiddenCount} card${hiddenCount === 1 ? '' : 's'} hidden (hidden cards expire after 30 days).`
    : 'Tap “Less like this” on a card to hide it and nudge its source down by half a point (max 3). Stored only on this phone, inspectable here, clearable below.';
  $('#interests').textContent = feed?.interests || 'interests.md is not in this build.';
}
function sourceLabel(src) {
  return { hn: 'Hacker News', lobsters: 'lobste.rs', bluesky: 'Bluesky', youtube: 'YouTube', huggingface: 'Hugging Face' }[src] || feed?.items.find((i) => i.source === src)?.sourceName || src;
}
$('#settings-btn').addEventListener('click', () => { renderSettings(); settings.showModal(); });
$('#settings-close').addEventListener('click', () => settings.close());
settings.addEventListener('click', (e) => { if (e.target === settings) settings.close(); });
settings.addEventListener('close', () => { const ta = $('#export-text'); ta.hidden = true; ta.value = ''; });
install.addEventListener('click', (e) => { if (e.target === install) install.close(); });
install.addEventListener('close', () => { state.installDismissedAt = Date.now(); save(); }); // button, backdrop or Escape all count
$('#btn-refresh').addEventListener('click', async () => { settings.close(); await refresh({ bust: true }); });
$('#btn-reset-seen').addEventListener('click', () => { state.seen = {}; save(); settings.close(); render(); });
$('#btn-clear-less').addEventListener('click', () => { state.less = {}; state.hidden = {}; save(); renderSettings(); render(); });
$('#btn-install-help').addEventListener('click', () => { settings.close(); install.showModal(); });
$('#install-dismiss').addEventListener('click', () => install.close());
$('#btn-copy-interests').addEventListener('click', async () => {
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
  const payload = { app: 'thirty', version: 1, exportedAt: new Date().toISOString(), state };
  const json = JSON.stringify(payload, null, 1);
  const file = new File([json], `thirty-backup-${new Date().toISOString().slice(0, 10)}.json`, { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: 'THIRTY backup' }); return; }
  } catch (err) { if (err?.name === 'AbortError') return; }
  const href = URL.createObjectURL(file);
  const a = el('a', { href, download: file.name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
  const ta = $('#export-text'); ta.value = json; ta.hidden = false;
  toast('Backup offered as a download. If nothing was saved, copy the text below.');
});
$('#import-file').addEventListener('change', async (e) => {
  const f = e.target.files?.[0]; if (!f) return;
  try {
    if (f.size > 2e6) throw new Error('file too large to be a THIRTY backup');
    const data = JSON.parse(await f.text());
    if (data?.app !== 'thirty' || !isMap(data.state)) throw new Error('not a THIRTY backup');
    state = normaliseState(data.state);
    const stored = save(); load(); renderSettings(); render();
    toast(stored ? 'Backup imported' : 'Backup imported for this session, but this device would not store it');
  } catch (err) { toast(`Import failed: ${err.message}`); }
  e.target.value = '';
});

// ---------- service worker: precached shell, stale-while-revalidate feed, "new build" banner ----------
async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    const promptUpdate = (worker) => { pending.worker = worker; showBanner(); };
    if (reg.waiting && navigator.serviceWorker.controller) promptUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) promptUpdate(w); });
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!wantReload) return; wantReload = false; location.reload(); });
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type !== 'feed-updated' || !feed) return;
      if (!(Date.parse(e.data.builtAt) > Date.parse(feed.builtAt))) return; // only ever move forward in time
      if (currentIndex === 0 && !interacted) { refresh(); return; }       // nothing read yet: swap silently
      pending.feed = true; showBanner();
    });
  } catch { /* no SW: the app still works online */ }
}

async function refresh({ bust = false } = {}) {
  try {
    const next = await loadFeed({ bust });
    feed = next; render(); updateStrip(); interacted = false;
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
    setText(builtEl, 'no feed');
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
