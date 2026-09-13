#!/usr/bin/env node
// THIRTY feed builder. Keyless. Fetches every source in sources.json, dedupes by
// normalised URL, merges the model-written scores in data/scores.json, gives any
// still-unscored item a conservative heuristic score, and writes public/feed.json
// sorted by score descending.
//
//   node scripts/build-feed.mjs              fetch + merge + write feed.json
//   node scripts/build-feed.mjs --unscored   also print the items that still need a model score
//   node scripts/build-feed.mjs --offline    skip fetching; rebuild feed.json from data/candidates.json
//
// Ranking contract: a model (this session, later the Routine) reads data/candidates.json
// and interests.md, then writes data/scores.json as { "<item id>": { "score": 0-10, "reason": "one line" } }.
// Re-running this script merges them. Nothing here calls a paid API or needs a key.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = {
  sources: path.join(ROOT, 'sources.json'),
  interests: path.join(ROOT, 'interests.md'),
  candidates: path.join(ROOT, 'data', 'candidates.json'),
  scores: path.join(ROOT, 'data', 'scores.json'),
  feed: path.join(ROOT, 'public', 'feed.json'),
};
const args = new Set(process.argv.slice(2));
const OFFLINE = args.has('--offline');
const UA = 'THIRTY-feed/1.0 (personal feed builder; +https://github.com/johancilliers22/thirty)';
const DAY = 86_400_000;
const now = Date.now();

// ---------- helpers ----------
async function get(url, { json = true, timeout = 20_000, retries = 1 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await fetch(url, { signal: ctl.signal, headers: { 'user-agent': UA, accept: json ? 'application/json' : '*/*' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return json ? await res.json() : await res.text();
    } catch (err) {
      if (attempt >= retries) throw err;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    } finally {
      clearTimeout(t);
    }
  }
}

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx]); } catch (err) { out[idx] = null; warn(`item ${idx}: ${err.message}`); }
    }
  }));
  return out.filter(Boolean);
}

const warnings = [];
function warn(msg) { warnings.push(msg); console.error('warn:', msg); }

const TRACKING = /^(utm_\w+|fbclid|gclid|ref_src|si|feature)$/i;
export function normaliseUrl(raw) {
  try {
    const u = new URL(raw);
    u.hash = '';
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
    if (u.hostname === 'youtu.be') { const id = u.pathname.slice(1); u.hostname = 'youtube.com'; u.pathname = '/watch'; u.search = `?v=${id}`; }
    const yt = u.hostname === 'youtube.com' && u.pathname.match(/^\/(shorts|embed|live)\/([\w-]+)/);
    if (yt) { u.pathname = '/watch'; u.search = `?v=${yt[2]}`; }
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    if (u.hostname === 'youtube.com' && u.pathname === '/watch') { const v = u.searchParams.get('v'); u.search = v ? `?v=${v}` : ''; }
    return u.toString().replace(/^https?:\/\//, '').replace(/\/+$/, ''); // host is already lower-case; paths and ids keep their case
  } catch { return String(raw).trim(); }
}

const domainOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
const clean = (s = '') => s.replace(/\s+/g, ' ').trim();
// a source's timestamp is untrusted: fall back through candidates, reject the unparseable and the future
// Hacker News hands us epoch milliseconds as a number, and Date.parse() only takes strings: it stringifies
// 1757726633000 and fails to parse it, so every HN story used to fall through to the build time.
const isoOr = (...vals) => { for (const v of vals) { const t = typeof v === 'number' ? v : Date.parse(v); if (Number.isFinite(t) && t < now + DAY) return new Date(t).toISOString(); } return new Date(now).toISOString(); };
const excerptOf = (s = '', n = 220) => { const c = clean(s); return c.length > n ? c.slice(0, n - 1).trimEnd() + '…' : c; };
const decodeXml = (s = '') => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d));

// ---------- sources ----------
async function hackerNews(cfg) {
  const ids = (await get('https://hacker-news.firebaseio.com/v0/topstories.json')).slice(0, cfg.top ?? 60);
  const items = await pool(ids, 12, (id) => get(`https://hacker-news.firebaseio.com/v0/item/${id}.json`));
  return items
    .filter((it) => it && it.type === 'story' && !it.dead && !it.deleted && (it.score ?? 0) >= (cfg.minPoints ?? 0))
    .map((it) => {
      const discussion = `https://news.ycombinator.com/item?id=${it.id}`;
      const url = it.url || discussion;
      return {
        id: `hn:${it.id}`, source: 'hn', sourceName: 'Hacker News', kind: 'link',
        title: clean(it.title), url, discussionUrl: discussion, domain: domainOf(url),
        author: it.by, publishedAt: isoOr(it.time * 1000),
        excerpt: it.text ? excerptOf(decodeXml(it.text.replace(/<[^>]+>/g, ' '))) : '',
        signals: { points: it.score, comments: it.descendants ?? 0 },
      };
    });
}

async function lobsters() {
  const list = await get('https://lobste.rs/hottest.json');
  return list.flatMap((s) => { try { return [lobstersItem(s)]; } catch (err) { warn(`lobsters item: ${err.message}`); return []; } });
}
function lobstersItem(s) {
    const url = s.url || s.short_id_url;
    return {
      id: `lob:${s.short_id}`, source: 'lobsters', sourceName: 'lobste.rs', kind: 'link',
      title: clean(s.title), url, discussionUrl: s.comments_url, domain: domainOf(url),
      author: s.submitter_user, publishedAt: isoOr(s.created_at),
      excerpt: excerptOf(s.description_plain || ''), tags: s.tags,
      signals: { points: s.score, comments: s.comment_count },
    };
}

const BSKY = 'https://public.api.bsky.app/xrpc';
const WHATS_HOT = 'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot';
const BSKY_BLOCK = new Set(['porn', 'sexual', 'nudity', 'graphic-media', '!warn', '!hide']);
function bskyPost(p) {
  const rec = p.record || {};
  if (rec.reply) return null; // replies are not cards
  if ((p.author.labels || []).some((l) => l.val === '!no-unauthenticated')) return null; // author opted out of logged-out viewing
  if ((p.labels || []).some((l) => BSKY_BLOCK.has(l.val))) return null; // moderation labels the client must honour
  const text = clean(rec.text || '');
  const ext = p.embed?.external || p.embed?.media?.external;
  if (!text && !ext) return null;
  const rkey = p.uri.split('/').pop();
  const url = `https://bsky.app/profile/${p.author.handle}/post/${rkey}`;
  const img = p.embed?.images?.[0]?.thumb || p.embed?.media?.images?.[0]?.thumb || ext?.thumb;
  return {
    id: `bsky:${rkey}:${p.author.did.slice(-8)}`, source: 'bluesky', sourceName: 'Bluesky', kind: 'post',
    title: ext?.title ? clean(ext.title) : excerptOf(text, 120), url, discussionUrl: url, domain: ext ? domainOf(ext.uri) : 'bsky.app',
    linkUrl: ext?.uri, author: p.author.displayName ? `${p.author.displayName} (@${p.author.handle})` : `@${p.author.handle}`,
    publishedAt: isoOr(rec.createdAt, p.indexedAt), excerpt: excerptOf(text, 280), thumbnail: img,
    signals: { likes: p.likeCount ?? 0, reposts: p.repostCount ?? 0 },
  };
}
async function bluesky(cfg) {
  const out = [];
  if (cfg.whatsHot) {
    const r = await get(`${BSKY}/app.bsky.feed.getFeed?feed=${encodeURIComponent(WHATS_HOT)}&limit=${cfg.whatsHotLimit ?? 30}`);
    for (const f of r.feed) { if (f.reason) continue; try { const it = bskyPost(f.post); if (it) out.push(it); } catch (err) { warn(`bluesky post: ${err.message}`); } }
  }
  for (const handle of cfg.handles || []) {
    try {
      const r = await get(`${BSKY}/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(handle)}&limit=10&filter=posts_no_replies`);
      for (const f of r.feed) { if (f.reason) continue; try { const it = bskyPost(f.post); if (it) out.push(it); } catch (err) { warn(`bluesky post: ${err.message}`); } }
    } catch (err) { warn(`bluesky ${handle}: ${err.message}`); }
  }
  return out;
}

async function youtube(cfg) {
  const per = cfg.perChannel ?? 4, maxAge = (cfg.maxAgeDays ?? 45) * DAY;
  const all = [];
  for (const ch of cfg.channels || []) {
    try {
      const xml = await get(`https://www.youtube.com/feeds/videos.xml?channel_id=${ch.id}`, { json: false });
      const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => m[1]);
      const pick = (e, tag) => decodeXml((e.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`)) || [])[1] || '');
      const items = entries.map((e) => {
        const videoId = pick(e, 'yt:videoId');
        const publishedAt = isoOr(pick(e, 'published'));
        const views = +((e.match(/<media:statistics views="(\d+)"/) || [])[1] || 0);
        return {
          id: `yt:${videoId}`, source: 'youtube', sourceName: ch.name, kind: 'video',
          title: clean(pick(e, 'title')), url: `https://www.youtube.com/watch?v=${videoId}`, domain: 'youtube.com',
          videoId, thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, author: ch.name, channelId: ch.id,
          publishedAt, excerpt: excerptOf(pick(e, 'media:description'), 200), signals: { views },
        };
      }).filter((it) => it.videoId && now - Date.parse(it.publishedAt) < maxAge)
        .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, per);
      all.push(...items);
    } catch (err) { warn(`youtube ${ch.name}: ${err.message}`); }
  }
  return all;
}

async function huggingFace(cfg) {
  const list = await get(`https://huggingface.co/api/models?sort=trendingScore&limit=${cfg.limit ?? 15}`);
  return list.flatMap((m) => { try { return [hfItem(m)]; } catch (err) { warn(`huggingface item: ${err.message}`); return []; } });
}
function hfItem(m) {
  return ({
    id: `hf:${m.modelId || m.id}`, source: 'huggingface', sourceName: 'Hugging Face', kind: 'model',
    title: m.modelId || m.id, url: `https://huggingface.co/${m.modelId || m.id}`, domain: 'huggingface.co',
    author: (m.modelId || m.id).split('/')[0], publishedAt: isoOr(m.createdAt),
    excerpt: [m.pipeline_tag && `Task: ${m.pipeline_tag}`, m.library_name && `Library: ${m.library_name}`, (m.tags || []).filter((t) => t.startsWith('license:')).map((t) => t.slice(8)).join(', ') && `License: ${(m.tags || []).filter((t) => t.startsWith('license:')).map((t) => t.slice(8)).join(', ')}`].filter(Boolean).join(' · '),
    signals: { likes: m.likes, downloads: m.downloads, trending: m.trendingScore },
  });
}

// ---------- heuristic fallback score (only for items the model has not scored yet) ----------
// only the top list of interests.md counts; everything under the first "## " sub-heading is notes
const interestLines = (md) => md.split(/\n## /)[0].split('\n').filter((l) => l.startsWith('- '));
function loadInterests(md) {
  const lines = interestLines(md);
  const low = lines.filter((l) => /^- score low/i.test(l));
  const high = lines.filter((l) => !/^- score low/i.test(l));
  const words = (ls) => [...new Set(ls.join(' ').toLowerCase().replace(/^- /gm, '').replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w)))];
  const phrases = (ls) => [...new Set(ls.flatMap((l) => l.replace(/^- (score low:)?/i, '').split(/[,;]/)).map((x) => x.trim().toLowerCase()).filter((x) => x.length > 4))];
  return { high: words(high), low: phrases(low) };
}
const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasWord = (hay, t) => new RegExp(`\\b${escapeRe(t)}\\b`, 'i').test(hay);
const STOP = new Set(['with', 'from', 'that', 'this', 'what', 'just', 'than', 'they', 'them', 'have', 'been', 'into', 'more', 'your', 'their', 'about', 'ideas', 'applied', 'quoted', 'thinking', 'building', 'running', 'people', 'writing', 'seriously', 'connected', 'something', 'real', 'these', 'areas', 'posts', 'notes', 'lists', 'talk', 'like', 'next', 'five', 'moves', 'life', 'daily', 'hold']);
function heuristic(item, interests) {
  const hay = `${item.title} ${item.excerpt || ''} ${item.domain} ${(item.tags || []).join(' ')}`.toLowerCase();
  const hits = interests.high.filter((t) => hasWord(hay, t));
  const lows = interests.low.filter((t) => hasWord(hay, t));
  let score = item.source === 'youtube' ? 5 : 2; // the YouTube channels were hand-picked by Johan, so they start warmer
  score += Math.min(4, hits.length);
  score -= Math.min(4, lows.length * 2);
  score = Math.max(0, Math.min(6, score)); // heuristic never outranks a model 7+
  const reason = hits.length ? `auto: matches ${hits.slice(0, 3).map((h) => `“${h}”`).join(', ')} in your interests` : lows.length ? `auto: looks like ${lows[0]}, which you asked to score low` : 'auto: nothing in your interests matches yet, awaiting model ranking';
  return { score, reason, auto: true };
}

// ---------- main ----------
async function main() {
  const cfg = JSON.parse(await readFile(P.sources, 'utf8'));
  const interestsMd = await readFile(P.interests, 'utf8');
  const interests = loadInterests(interestsMd);
  // the interest lines travel with the feed so the settings sheet can show them read-only. The repo is
  // public, so these lines already are; only the top list is included, never the notes below the first
  // sub-heading (which name people and channels).
  const interestsText = interestLines(interestsMd).join('\n');
  await mkdir(path.dirname(P.candidates), { recursive: true });
  await mkdir(path.dirname(P.feed), { recursive: true });

  let candidates;
  if (OFFLINE) {
    candidates = JSON.parse(await readFile(P.candidates, 'utf8')).items;
  } else {
    const runs = [
      ['hn', () => hackerNews(cfg.hackerNews || {})],
      ['lobsters', () => (cfg.lobsters?.enabled === false ? [] : lobsters())],
      ['bluesky', () => bluesky(cfg.bluesky || {})],
      ['youtube', () => youtube(cfg.youtube || {})],
      ['huggingface', () => huggingFace(cfg.huggingFace || {})],
    ];
    const results = await Promise.all(runs.map(async ([name, fn]) => {
      try { const r = await fn(); console.error(`${name}: ${r.length}`); return r; } catch (err) { warn(`${name} failed: ${err.message}`); return []; }
    }));
    const okSources = results.filter((r) => r.length > 0).length;
    let previousCount = 0, previousCounts = {};
    try { const prev = JSON.parse(await readFile(P.feed, 'utf8')); previousCount = prev.items.length; previousCounts = prev.counts || {}; } catch { /* first build */ }
    const fetched = results.flat().length;
    // A source that carried the last build, errored on this one and returned nothing is an outage, not a
    // quiet news day. The count guard alone cannot see it: YouTube is ~12% of the items but most of the top
    // of the feed, so losing all seven channels still leaves 85% of the count and publishes a feed with no
    // book summaries in it. Requiring a recorded warning keeps a source switched off in sources.json quiet.
    const vanished = runs
      .map(([name], i) => ({ name, n: results[i].length }))
      .filter(({ name, n }) => n === 0 && (previousCounts[name] || 0) > 0 && warnings.some((w) => w.startsWith(`${name} `)))
      .map(({ name }) => name);
    if (fetched === 0 || (previousCount > 0 && fetched < previousCount * 0.25) || vanished.length) {
      const why = vanished.length
        ? `every item from ${vanished.map((s) => `${s} (had ${previousCounts[s]})`).join(', ')} is gone and the source errored`
        : `${fetched} items fetched from ${okSources} sources (previous feed had ${previousCount})`;
      console.error(`refusing to publish: ${why}; feed.json, scores.json and candidates.json left untouched`);
      process.exit(2);
    }
    const maxAge = (cfg.maxAgeDays ?? 7) * DAY;
    // YouTube has its own window; Hugging Face trending is already a freshness signal, so createdAt is not filtered
    candidates = results.flat().filter((it) => it.source === 'youtube' || it.source === 'huggingface' || now - Date.parse(it.publishedAt) < maxAge);
  }

  // third-party URLs: only http(s) survives into the feed (a Bluesky external embed is a free string)
  const httpOnly = (u) => { try { const p = new URL(u); return p.protocol === 'https:' || p.protocol === 'http:' ? p.href : undefined; } catch { return undefined; } };
  candidates = candidates.map((it) => ({ ...it, url: httpOnly(it.url), linkUrl: httpOnly(it.linkUrl), discussionUrl: httpOnly(it.discussionUrl), thumbnail: httpOnly(it.thumbnail) }))
    .filter((it) => { if (!it.url) warn(`dropped ${it.id}: bad url`); return !!it.url; });

  // dedupe by normalised URL; keep the copy with the most engagement (HN points win ties by order)
  const byUrl = new Map();
  for (const it of candidates) {
    const key = normaliseUrl(it.linkUrl || it.url);
    const prev = byUrl.get(key);
    // an HN or lobste.rs record carries a discussion thread and comparable points; it wins over a post about the same link
    const weight = (x) => (x.source === 'hn' || x.source === 'lobsters' ? 1000 : 0) + (x.signals?.points ?? 0) + (x.signals?.likes ?? 0) / 20 + (x.signals?.views ?? 0) / 1000;
    if (!prev || weight(it) > weight(prev)) byUrl.set(key, { ...it, discussionUrl: it.discussionUrl || prev?.discussionUrl });
    else if (!prev.discussionUrl && it.discussionUrl) prev.discussionUrl = it.discussionUrl;
  }
  const unique = [...byUrl.values()];

  // merge scores
  let scores = {};
  if (existsSync(P.scores)) scores = JSON.parse(await readFile(P.scores, 'utf8'));
  const items = unique.map((it) => {
    const s = scores[it.id];
    const ranked = s && Number.isFinite(+s.score) ? { score: Math.max(0, Math.min(10, Math.round(+s.score))), reason: clean(s.reason || ''), auto: false } : heuristic(it, interests);
    if (s && !s.scoredAt) s.scoredAt = new Date(now).toISOString();
    const { signals, key, ...pub } = it; // engagement counts and the dedupe key stay in candidates.json; the app never shows them
    return { ...pub, ...ranked };
  }).sort((a, b) => b.score - a.score || Date.parse(b.publishedAt) - Date.parse(a.publishedAt));

  const bySource = {};
  for (const it of items) bySource[it.source] = (bySource[it.source] || 0) + 1;
  const unscored = items.filter((it) => it.auto);

  await writeFile(P.candidates, JSON.stringify({ fetchedAt: new Date(now).toISOString(), items: unique }, null, 1));
  // prune scores by age (30 days), never by absence: a source that is down for one run keeps its scores.
  // On a run with any warning nothing is pruned at all.
  const SCORE_TTL = 30 * DAY;
  const kept = warnings.length ? scores : Object.fromEntries(Object.entries(scores).filter(([id, v]) => unique.some((u) => u.id === id) || now - Date.parse(v.scoredAt || 0) < SCORE_TTL));
  await writeFile(P.scores, JSON.stringify(kept, null, 1) + '\n');

  const feed = {
    builtAt: new Date(now).toISOString(),
    version: 1,
    sessionSize: 30,
    counts: bySource,
    unscored: unscored.length,
    warnings,
    interests: interestsText,
    items,
  };
  await writeFile(P.feed, JSON.stringify(feed));
  console.error(`feed.json: ${items.length} items (${unscored.length} heuristic, ${items.length - unscored.length} model-ranked); sources ${JSON.stringify(bySource)}`);

  if (args.has('--unscored')) {
    console.log(unscored.map((it) => `${it.id} | ${it.sourceName} | ${it.title} | ${it.domain}${it.excerpt ? ' | ' + it.excerpt.slice(0, 140) : ''}`).join('\n'));
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
