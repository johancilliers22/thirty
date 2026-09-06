# THIRTY

A personal short-form feed for the iPhone: one card per screen, ranked 0-10 for "worth 30 seconds of
Johan's attention" against `interests.md`, with a one-line reason on every card. Built as a static PWA,
added to the Home Screen from Safari, rebuilt twice a day by a cloud Routine. The thing to open instead
of TikTok, and the reason is on the card. Thirty cards, then a stop.

- Brief and build plan: `docs/KICKOFF.md` (idea 1 of HOLIDAY-2026-09; sources, corrections, additions, done-when)
- Design notes with citations: `DESIGN.md` (what was verified, what was not, and what the build does about it)
- Interests: `interests.md` (one line per interest; the last line says what scores low; edit from the GitHub app)
- Sources: `sources.json` (YouTube channel ids, Bluesky handles, limits; edit from the GitHub app)
- Rules: `CLAUDE.md`

## Layout

| Path | What |
|---|---|
| `scripts/build-feed.mjs` | Keyless fetch of every source, dedupe by URL, merge scores, write `public/feed.json` sorted by score |
| `data/candidates.json` | The fetched, deduped candidates of the last build (the model reads this to rank) |
| `data/scores.json` | `{ "<item id>": { "score": 0-10, "reason": "one line" } }` written by the ranking model |
| `public/feed.json` | The feed the app loads; `builtAt`, `interests`, `items[]` |
| `index.html`, `src/` | The Vite PWA |
| `public/sw.js` | Service worker: precached shell, stale-while-revalidate feed, offline reopen, new-build banner |
| `public/manifest.webmanifest`, `public/icons/` | Installability; icons rendered from `icon.svg` by `scripts/make-icons.mjs` |
| `vercel.json` | Cache headers for the feed, the worker, hashed assets |
| `scripts/screenshots.mjs` | Playwright check at 390x844 and 430x932, plus offline reopen and the install screen |

## Rebuild contract (what the Routine does, and what a session does by hand)

```
npm ci
node scripts/build-feed.mjs --unscored      # fetch, dedupe, merge existing scores, print items still unscored
# rank: read interests.md and data/candidates.json, write data/scores.json for every unscored id
node scripts/build-feed.mjs --offline       # merge the new scores into public/feed.json without refetching
git add data/scores.json data/candidates.json public/feed.json
git commit -m "Rebuild feed <date>" && git push origin main   # Vercel deploys main on push
```

Items the model has not scored get a capped heuristic score (never above 6) with a reason prefixed `auto:`,
so the feed is never unranked, but the model pass is what the app is for.

## Local

```
npm install
npm run feed       # fetch and rebuild public/feed.json
npm run build      # vite build + stamp the service worker
npm run preview    # http://127.0.0.1:4173
npm run shots      # Playwright screenshots into shots/ (needs CHROME_PATH or the VM's Chromium)
```

Nothing here needs a key. Nothing posts anywhere. The only publish is the Vercel deploy of this repo.
