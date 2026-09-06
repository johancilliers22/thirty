# THIRTY design notes

Reconciled from three research passes run on 2026-09-05 by parallel researcher subagents on Opus, each answering
only from primary sources it could fetch (developer.apple.com, webkit.org, web.dev, MDN, vercel.com, vite.dev,
arXiv and journal pages, the Lighthouse changelog). Every finding carries its status: **VERIFIED** (quoted from a
primary source), **PARTIAL** (primary source found but it does not fully answer), or **UNVERIFIED** (no primary
source reachable). Where a finding is UNVERIFIED the build takes the conservative path stated next to it.
Section 5 lists hosts that refused the VM. Section 6 says what the build actually does with all of this.

## 0. The ten findings that shaped the build

1. Home Screen web apps are exempt from WebKit's 7-day script-storage cap and keep their own isolated storage; general LRU eviction still exists. (VERIFIED, webkit.org)
2. `env(safe-area-inset-*)` is zero unless the viewport meta carries `viewport-fit=cover`. (VERIFIED, webkit.org, MDN)
3. `100dvh` shipped in Safari 15.4 and, with no browser chrome in standalone mode, equals `svh` and `lvh`; `vh` is defined as `lvh`. (VERIFIED, webkit.org, MDN)
4. Muted `playsinline` `<video>` may autoplay without a gesture, but nothing primary covers autoplay inside a YouTube iframe, so video is tap-to-play with the gesture starting a muted inline embed. (VERIFIED for `<video>`, UNVERIFIED for iframes, webkit.org)
5. `apple-touch-icon` takes precedence over manifest icons on iOS; a manifest with `display: standalone` is what makes a Home Screen web app. (VERIFIED, webkit.org)
6. Autoplay and recommendations undermine users' sense of agency; a playlist's end is "a good place to stop" while recommendations feel "endless". (VERIFIED, Lukoff et al. CHI 2021)
7. Turning Netflix autoplay off cut sessions by about 18 minutes and daily viewing by about 21 minutes in a randomised experiment; the authors recommend off by default. (VERIFIED, arXiv 2412.16040)
8. Explaining why an item was recommended improves acceptance; an unconvincing explanation lowers trust, so the reason line must be the real reason. (VERIFIED Herlocker et al. 2000; PARTIAL Tintarev and Masthoff)
9. Social-proof counts change what people sample without predicting what they value, so cards show no likes, views or points. (VERIFIED via PLOS ONE 2012 restating Salganik, Dodds and Watts 2006)
10. Vercel's default `Cache-Control` is `public, max-age=0, must-revalidate`; `s-maxage` plus `stale-while-revalidate` is the documented way to let the edge absorb traffic while the browser always revalidates. (VERIFIED, vercel.com)

## 1. iOS Home Screen web apps, as of 2026-09-05

| Topic | Finding | Status | Source and quote |
|---|---|---|---|
| Storage eviction | Home Screen web apps are exempt from the 7-day ITP cap on script-writable storage and have their own day counter. General eviction under quota pressure or long non-interaction remains, LRU by last interaction; origins in persistent mode are excluded. `navigator.storage.persist()` exists and WebKit grants it heuristically. | VERIFIED | webkit.org/tracking-prevention/: "The first-party domain of home screen web applications is exempt from ITP's 7-day cap on all script-writeable storage." webkit.org/blog/14403/: "WebKit currently grants a request based on heuristics like whether the website is opened as a Home Screen Web App." |
| Storage quota | Standalone gets the same quota as the browser: up to 60% of disk per origin in a browser app; Cache API, localStorage, IndexedDB and service workers all count. The 2018 figure of 50 MiB per Cache API partition may be superseded by the 2023 policy; the two were not reconciled by any single page. | VERIFIED (caveat) | webkit.org/blog/14403/: "it has the same origin quota and overall quota as when it is opened in a browser app." webkit.org/blog/8090/: "The current Cache API quota is set to a fixed value of 50 MiB per partition." |
| Web Push | Available from iOS 16.4 only to web apps added to the Home Screen, with a manifest `display` of `standalone` or `fullscreen`, requested from a user gesture. Not used in v1 (nothing posts, nothing notifies). | VERIFIED | webkit.org/blog/13966/: "iOS and iPadOS 16.4 add support for Web Push to web apps added to the Home Screen." |
| Safe-area insets | Insets are 0 until `viewport-fit=cover`; they cover rounded corners, sensor housing and the home indicator. No primary source states how the values differ in standalone mode, so they are read at runtime, never hard-coded. | VERIFIED / PARTIAL | webkit.org/blog/7929/: "In order to disable that behavior and cause the page to lay out to the full size of the screen, you can set viewport-fit to cover." MDN env(): "The values are 0 if the viewport is a rectangle…" |
| `-webkit-touch-callout` | `none` disables the callout shown on touch-and-hold of a link; the property is non-standard. Its interaction with `user-select` and `contextmenu` is not documented anywhere primary. | PARTIAL | MDN: "controls the display of the default callout shown when you touch and hold a touch target." |
| Scroll-snap in standalone | No primary source documents any difference between a Home Screen app and a Safari tab. `overscroll-behavior` shipped in Safari 16.0; `contain` "disables native browser navigation, including the vertical pull-to-refresh gesture" and has no effect on an iframe. | UNVERIFIED (snap) / VERIFIED (overscroll) | webkit.org/blog/13152/ (Safari 16.0 features); MDN overscroll-behavior. |
| dvh vs vh | `svh`, `lvh`, `dvh` shipped in Safari 15.4. `vh` equals `lvh`. In standalone there is no retracting chrome, so the three coincide (inference, not quoted). | VERIFIED / PARTIAL | webkit.org/blog/12445/: "100dvh refers to 100% of the dynamic viewport height". MDN length: "vh is equivalent to lvh". |
| Pull-to-refresh | web.dev says Safari refreshes a page pulled down; nothing primary says whether standalone mode has it. Conservative path: `overscroll-behavior-y: contain` on the scroll container regardless. | PARTIAL / UNVERIFIED (standalone) | web.dev/learn/pwa/app-design: "Modern mobile browsers, such as Google Chrome and Safari, have a feature that refreshes the page when it is pulled down." |
| Muted autoplay | `<video muted>` and `<video playsinline>` may autoplay inline without a gesture; a gesture is a `touchend`, `click`, `doubleclick` or `keydown` handler. Iframes are not covered. | VERIFIED (`<video>`) / UNVERIFIED (iframe) | webkit.org/blog/6784/: "`<video muted>` elements will also be allowed to autoplay without a user gesture." |
| Icons and meta tags | `apple-touch-icon` wins over manifest icons; Apple documents 180x180 for iPhone. `apple-mobile-web-app-capable` still documented (archive); `mobile-web-app-capable` as its replacement is not documented on MDN (both sub-pages 404). Both tags are shipped. | VERIFIED / UNVERIFIED (replacement) | webkit.org/blog/13878/: "apple-touch-icon will take precedence over the Manifest-declared icons". |
| Service workers | Available to Home Screen apps; partitioned by top-level origin; a Home Screen app shares no website data with Safari; unused registrations and unopened caches are removed "after a few weeks". | VERIFIED | webkit.org/blog/8090/: "WebKit will remove unused service worker registrations after a period of a few weeks." |

## 2. A feed that is the opposite of TikTok

### Evidence

- **Agency.** Lukoff, Lyngs, Zade, Liao, Choi, Fan, Munson and Hiniker, "How the Design of YouTube Influences User Sense of Agency", CHI 2021, arxiv.org/abs/2101.11778: "autoplay and recommendations primarily undermine sense of agency, while search and playlists support it." Participants "described the end of a playlist as a 'good place to stop', in contrast to browsing recommendations, which they described as 'endless.'" VERIFIED.
- **Variable reward.** Nir Eyal, nirandfar.com/how-to-manufacture-desire/: "Variable schedules of reward are one of the most powerful tools that companies use to hook users." VERIFIED. Center for Humane Technology, humanetech.com/the-cht-perspective, names "red notifications, algorithmic curation, intermittent reinforcement, and infinite scroll" as the addictive layer. VERIFIED.
- **Infinite scroll and dissociation.** Ruiz, Molina León and Heuer, "Design Frictions on Social Media", MuC 2024, arxiv.org/abs/2407.18803: "Design features of social media platforms, such as infinite scroll, increase users' likelihood of experiencing normative dissociation". VERIFIED. Nielsen Norman Group, nngroup.com/articles/infinite-scrolling-tips/: infinite scroll "works best for situations where users will want to scroll through homogeneous items with no particular task or goal in mind". VERIFIED.
- **No visible end.** Wansink, Painter and North, "Bottomless Bowls", 2005, plus the 2023 preregistered replication: diners with self-refilling bowls ate about 73% more and "did not believe they had consumed more". PARTIAL: Wiley, PubMed and APA all refused the VM (403 or JS shell); wording is from the abstract as indexed.
- **Autoplay-next.** "An Experimental Study of Netflix Use and the Effects of Autoplay on Watching Behaviors", arxiv.org/abs/2412.16040: "Turning off autoplay resulted in about an 18 minute decrease in average session lengths" and "about a 21 minute decrease in average watching time per day"; the authors "commit to having autoplay disabled by default". VERIFIED.
- **Explanations.** Herlocker, Konstan and Riedl, "Explaining Collaborative Filtering Recommendations", CSCW 2000 (University of Minnesota repository): "providing explanations can improve the acceptance of ACF systems." VERIFIED. Tintarev and Masthoff (Springer, redirect to identity provider): "transparency may lead to an increase or decrease in trust, depending on how much confidence users have in the internal working of the system". PARTIAL. EU Digital Services Act Art. 27 (digitalacts.eu; EUR-Lex recital 70): "The main parameters ... shall explain why certain information is suggested to the recipient of the service." VERIFIED.
- **Diversity.** Carbonell and Goldstein, "The Use of MMR, Diversity-Based Reranking", SIGIR 1998: "The Maximal Marginal Relevance (MMR) criterion strives to reduce redundancy while maintaining query relevance". VERIFIED. Steck, "Calibrated Recommendations", RecSys 2018: ACM DL returned 403; definition VERIFIED from the survey arxiv.org/abs/2507.02643: "the properties of the items that are suggested to users should match the distribution of their individual past preferences." No published source prescribes a numeric per-source cap. UNVERIFIED as to any number.
- **Negative feedback.** YouTube Help support.google.com/youtube/answer/6342839: feedback can be reviewed and cleared. VERIFIED. Mozilla, "Does This Button Work?", 2022: controls "prevent less than half of unwanted recommendations". PARTIAL: every Mozilla host returned 403.
- **Counts.** Salganik, Dodds and Watts, Science 2006 (science.org 403), via Krumme et al., PLOS ONE 2012, journals.plos.org/plosone/article?id=10.1371/journal.pone.0033785: "the addition of social influence to a cultural market increased the unpredictability as well as the inequality of the market share" and "Social influence is material to the first step only". VERIFIED via the restatement.

### Rules applied to THIRTY

1. A session is exactly 30 cards (or fewer if fewer are new) and ends in a "You're done" card with nothing behind it. From Lukoff et al. (a playlist end is a legitimate stop) and Wansink et al. (no visible end means unnoticed overconsumption). The number 30 is a product decision and the app's name; no source prescribes an N. UNVERIFIED as a number, stated as such.
2. No infinite scroll, no silent second batch, no "load more". From NN/g and Ruiz et al. The only way to see more is "Start over" in Settings, an explicit act.
3. Nothing plays, advances or opens without a tap. YouTube cards show the thumbnail with a play button; the tap starts a muted inline embed; the next card never autoplays. From the Netflix experiment and Lukoff et al.
4. Every card carries the real reason for its score in one line, naming the interests line it matched or the "score low" rule it hit. From Herlocker et al. and Tintarev and Masthoff.
5. The ranking parameters are published in plain language inside the app: the Settings sheet shows the interests block read-only and explains that interests.md is the parameter surface, edited in the GitHub app. From DSA Art. 27 and recital 70.
6. Source diversity by re-ranking, not raw order: within the session, no source appears more than 2 cards in a row and no source fills more than 40% of the session (12 of 30); within those constraints, highest score first. An MMR-style greedy pass with source as the similarity term. From Carbonell and Goldstein; the cap numbers are the build's own approximation, labelled as such.
7. feed.json itself stays strictly sorted by score descending (the hub's "Done when" checks that); the diversity pass runs on the phone at render time and is documented here.
8. No likes, views, points, reposts or any popularity number on a card. The only number is the 0-10 fit score. From Salganik, Dodds and Watts. Engagement signals still travel in feed.json (used for dedupe tie-breaks) but are never rendered.
9. "Less like this" has an instant, visible effect: the card disappears, a toast says exactly what was recorded (source nudged down by half a point, max 3), the nudges are listed in Settings and can be cleared or undone. From Mozilla 2022 and YouTube Help.
10. No streaks, badges, red counts, pull-to-refresh or "new content" notifications. The feed is rebuilt on a fixed cadence and is the same set until the next build; a "New cards are ready" banner appears only when a newer build has actually arrived, and it waits for a tap. From Eyal and CHT.
11. Highest-fit cards first, so stopping early is a rational stop, not a loss. From Lukoff et al.

Not adopted because unverified: any specific N; the "37% less watch time" claim (content-farm only); well-being claims for hiding counts (the peer-reviewed Instagram like-visibility study found mixed effects, so rule 8 rests on ranking integrity, not well-being); forced "react before the next card" friction (verified for recall in Ruiz et al., but most participants found it frustrating).

## 3. Offline-first patterns

| Pattern | Finding | Status | Source and quote |
|---|---|---|---|
| Shell precache | Versioned cache opened in `install`, `cache.addAll` inside `waitUntil`, stale caches deleted in `activate`; `skipWaiting()` and `clients.claim()` are the opt-outs from the default lifecycle. Vite emits content-hashed filenames, so a hand-maintained list goes stale; either generate it from the build (vite-plugin-pwa via workbox-build) or discover it at install time. | VERIFIED | MDN PWA Caching guide: "A PWA should clean up any old versions of its cache in the service worker's activate event". vite.dev/guide/assets: hashed names like `/assets/img.2d8efhg.png`. |
| Feed SWR | Return the cached copy, always fetch, `cache.put` only when `response.ok` so an error page never replaces the last good feed; tell the page via `client.postMessage()` or a `BroadcastChannel`. | VERIFIED | MDN Caching: "we always send the request to the network, even after a cache hit, and use the response to refresh the cache." MDN ServiceWorker.postMessage. |
| New build available | Check `registration.waiting` on load, listen for `updatefound` then `statechange`, send `SKIP_WAITING` from a user action, reload once on `controllerchange` with a guard against loops. | VERIFIED | web.dev/articles/service-worker-lifecycle: "You may want to call it as a results of a postMessage() to the service worker. As in, you want to skipWaiting() following a user interaction." |
| Cache limits | Under WebKit quota; evicted "when exceeding the overall quota, when the system is under storage pressure, or when the site has not been interacted with by the user for some time". `persist()` support as a compat-table fact did not render on MDN. | VERIFIED / PARTIAL | webkit.org/blog/14403/. |
| Web Share with files | Level 2 file sharing shipped in Safari 15; needs `navigator.canShare({ files })` and a user gesture. Behaviour inside a standalone app is not documented; `<a download>` works for `blob:` URLs; `<input type=file accept>` handling on iOS is not documented. | PARTIAL / UNVERIFIED | webkit.org/blog/11989/: "Web Share level 2 enhancements to Web Share enable sharing files from a web page to an app." MDN `<a>`: "download only works for same-origin URLs, or the blob: and data: schemes." |
| Vercel caching | Default `public, max-age=0, must-revalidate`; `s-maxage` is stripped before the client sees it; `headers` in vercel.json take `source` plus key/value pairs; hashed assets should get `max-age=31536000, immutable`; the docs' own example sets the service worker to `max-age=0, must-revalidate`. The Vite preset's `dist` output directory is documented on the Vite side, not on vercel.com. | VERIFIED / PARTIAL (dist) | vercel.com/docs/caching/cache-control-headers: "The default value is cache-control: public, max-age=0, must-revalidate which instructs both the CDN and the browser not to cache." |
| Installability | Chrome needs name or short_name, 192 and 512 icons, start_url, a standalone-class display, HTTPS; `theme_color`, `background_color`, `orientation` are supported but not criteria; `purpose: maskable` marks an icon safe to crop. Lighthouse removed the PWA category in v12.0.0 (2024-04-22). A service worker is no longer required for menu install since Chrome 108 mobile / 112 desktop. | VERIFIED | web.dev/articles/install-criteria; Lighthouse changelog: "As per Chrome's updated Installability Criteria, Lighthouse has removed the PWA category"; developer.chrome.com/blog/update-install-criteria. |
| Offline indicator | `navigator.onLine` is "inherently unreliable, and you should not disable features based on the online status, only provide hints". The honest indicator is data provenance: the build time. | VERIFIED | MDN Navigator.onLine. |
| Fallback | A fetch handler must always return a `Response`; fall back to the cached shell, then to a small error response. | VERIFIED | MDN Offline and background operation: "If the resource could not be fetched, return some default fallback resource." |

## 4. Conservative paths taken for everything UNVERIFIED

- Scroll-snap in standalone: snapping is on a dedicated `overflow-y: scroll` container, not `body`; `overscroll-behavior-y: contain` is set; device testing is Johan's step in session 2.
- YouTube iframe autoplay: never attempted without a tap; the thumbnail is the card; the embed carries `autoplay=1&mute=1&playsinline=1` as progressive enhancement after the gesture.
- Pull-to-refresh in standalone: assumed possible and suppressed with `overscroll-behavior`.
- `mobile-web-app-capable` as a replacement: both meta tags shipped.
- Web Share in standalone: feature-detected with `canShare`; falls back to a Blob download and to a visible text box to copy.
- `<input type=file accept>` on iOS: the import path ignores `accept` and validates the parsed JSON (`app: "thirty"` and a `state` object).
- Storage persistence: `navigator.storage.persist()` requested once; a `false` answer is normal; all state survives loss (the feed re-fetches, seen/muted/nudges are exportable).
- Cache size: shell plus feed plus at most 90 thumbnails, far below any documented quota.
- Safe-area values: read from `env()` at runtime; never hard-coded.

## 5. Hosts that refused or could not serve the VM

No research host returned 403 for the first (iOS) and third (PWA) passes. The second pass (attention and ranking literature) hit these; each is recorded rather than substituted:

| Host | URL | Result |
|---|---|---|
| dl.acm.org | Lukoff et al. full HTML; Steck 2018 | 403 |
| mozillafoundation.org | "Does This Button Work?" report and blog | 403 |
| onlinelibrary.wiley.com | Wansink et al. 2005 | 403 |
| pubmed.ncbi.nlm.nih.gov | Wansink 2005; 2023 replication | 403 |
| science.org | Salganik, Dodds and Watts 2006 | 403 |
| grouplens.org | Herlocker et al. PDF | 503 |
| link.springer.com | Tintarev and Masthoff 2012 | 303 to identity provider |
| researchsquare.com | demetrication preprint | 403 |
| psycnet.apa.org | Wansink replication | JS shell, no content |
| developer.apple.com | Safari 15.4 and 16 release notes | 200 but JS-rendered, empty body |
| developer.mozilla.org | meta name mobile-web-app-capable, apple-mobile-web-app-capable, Attributes/download | 404 |
| developer.apple.com | documentation/webkit/configuring-your-webpage-to-appear-on-the-home-screen-of-ios | 404 |

Contrary to the brief, fonts.googleapis.com and api.github.com both returned 200 from this VM on 2026-09-05 (a probe with curl). Google Fonts are still not used: the app uses the system font stack so that text follows Dynamic Type.

If Johan wants the literature quotes re-verified from their primary hosts, the domains to allow are dl.acm.org, mozillafoundation.org, onlinelibrary.wiley.com, pubmed.ncbi.nlm.nih.gov, science.org, grouplens.org and link.springer.com.

## 6. What the build does with this

- `index.html`: `viewport-fit=cover`; `apple-mobile-web-app-capable`, `mobile-web-app-capable`, `black-translucent` status bar; `apple-touch-icon` 180x180; manifest link; `color-scheme` and two `theme-color` metas; `robots noindex`.
- `public/manifest.webmanifest`: `display: standalone`, `orientation: portrait`, `start_url: /?source=pwa`, `id`, `scope`, 192 and 512 icons plus a 512 maskable icon rendered from `icons/icon.svg` with 78% content scale.
- `src/style.css`: light palette on `:root`, dark palette under `prefers-color-scheme: dark`; `font: -apple-system-body` so text scales with the system size; `100dvh` with `100vh` fallback; safe-area padding on the strip, cards and sheets; `scroll-snap-type: y mandatory` with `scroll-snap-stop: always` on the deck; `overscroll-behavior-y: contain`; `-webkit-touch-callout: none` and `user-select: none` on cards; `prefers-reduced-motion` turns smooth scrolling and transitions off; every text colour passes 4.5:1 in both palettes.
- `src/main.js`: session builder (30 cards, diversity re-rank, mutes, nudges, seen filter), tap to open in a new tab, long-press (550 ms, cancelled by movement) to mute the source for 7 days with Undo, "Less like this" with Undo and an inspectable list, "You're done" card, built-N-hours strip that turns amber past 14 hours and appends "offline copy" when the browser reports offline, install screen for iPhone Safari visitors (never inside the installed app, dismissable for 7 days, re-openable from Settings), settings sheet with read-only interests and Copy, export via `navigator.share({ files })` with Blob-download and text fallbacks, import with validation, `navigator.storage.persist()` once, every localStorage access in try/catch.
- `public/sw.js`: on install fetches `index.html` and precaches every `/assets`, `/icons` and manifest URL it references, so Vite's hashed names never go stale; navigation is network-first with the cached shell as fallback; `/feed.json` is stale-while-revalidate with an `ok` guard and a `feed-updated` message when `builtAt` changes; thumbnails from ytimg and cdn.bsky.app are cache-first, capped at 90; the fetch handler always returns a `Response`. `scripts/postbuild.mjs` stamps a build id into the worker so each deploy is a byte-different worker and the "New version" banner works; the reload on `controllerchange` only fires after the user accepted the update, never on first install.
- `vercel.json`: `/feed.json` gets `max-age=0, s-maxage=300, stale-while-revalidate=3600`; `/sw.js` and the manifest get `max-age=0, must-revalidate`; `/assets/*` gets one-year immutable; nosniff, referrer and frame headers on everything.
- `scripts/build-feed.mjs`: keyless fetches (Hacker News Firebase top 60 with 20+ points, lobste.rs hottest, Bluesky what's-hot without replies and without authors who opted out of logged-out viewing, YouTube channel RSS for seven resolved channel ids, Hugging Face trending); dedupe by normalised URL (tracking parameters stripped, youtu.be folded into youtube.com); model scores merged from `data/scores.json`; a capped heuristic score (never above 6, reason prefixed "auto:") for anything the model has not scored yet; output sorted by score descending, then recency.

## 7. Ranking rubric (how scores in data/scores.json were assigned)

Score every candidate 0-10 for "worth 30 seconds of Johan's attention" against the lines in interests.md. 9-10: a named author, book or idea from a listed shelf, or a new book in a listed area, presented as an idea to use. 7-8: squarely on a shelf, or a strong AI-agents/Claude Code item tied to building something. 5-6: adjacent (a good essay on thinking, a frontier-model release, a human-behaviour story). 3-4: generic curiosity or tooling with a thin link to a shelf. 0-2: off-shelf tech minutiae, and anything the "score low" line names (gossip, sports, crypto prices, political outrage, unsourced motivation, engagement bait). Sponsored or affiliate posts score 2 even from a listed channel. The reason names the shelf or the rule, in one sentence, without claiming more than the title and excerpt support.

## 8. Verification on 2026-09-06 (build VM, Chromium 1194, Lighthouse 13.4.1)

Lighthouse, mobile preset, 390x844 at 3x, against `vite preview` of the production build:

| Category | Score | Notes |
|---|---|---|
| Performance | 100 | FCP 0.9 s, LCP 1.1 s, TBT 30 ms, CLS 0 |
| Accessibility | 100 | contrast fixed in both palettes (tertiary text 6.1:1 light, 6.8:1 dark; light accent 5.9:1) |
| Best practices | 100 | no console errors once the service worker stopped reloading on first install |
| SEO | 66 | the only failing audit is `is-crawlable`: `index.html` carries `robots noindex` and `robots.txt` disallows all. Deliberate: a personal feed on a public Hobby URL should not be indexed. Removing the meta tag and the disallow line would score 100; that is Johan's call. |

Lighthouse removed its PWA category in v12.0.0 (2024-04-22), confirmed in the changelog, so installability was checked by hand against `dist/`:

| Check | Result |
|---|---|
| Manifest linked from index.html; name and short_name | pass |
| start_url within scope; display standalone; orientation portrait | pass |
| 192, 512 and 512 maskable PNG icons present | pass |
| theme_color and background_color | pass |
| apple-touch-icon 180x180 linked and present | pass |
| apple-mobile-web-app-capable, mobile-web-app-capable, status-bar-style | pass |
| viewport-fit=cover | pass |
| sw.js shipped with a per-build id; registered from the app bundle | pass |
| HTTPS | pass on Vercel; the local preview is http |

Playwright (Chromium, iPhone 13 profile) at 390x844 and 430x932: 30 cards then the done card, first three cards screenshotted at both sizes plus light palette, settings, done, offline reopen (30 cards, strip reads "built N ago · offline copy") and the install sheet on a Safari user agent. Headless Chromium cannot reach the internet from the build VM (its egress proxy resets browser traffic while curl succeeds), so the screenshot script hands thumbnails to the page through route interception after fetching them with curl; the app is untouched.

Sandbox test of the feed builder: with every fetch failing it exits 2 and leaves `feed.json`, `scores.json` and `candidates.json` untouched; with lobste.rs alone returning 503 the run publishes the other sources and keeps all lobste.rs scores.

## 9. Binding constraints carried from the brief

The agent-system clone (with `docs/holiday-builds/thirty-feed.md` and the holiday README) was not present in this environment, so the constraints were taken from `docs/KICKOFF.md`, which carries the CORRECTION line and the additions verbatim:

- Hugging Face trending is fetched keyless from `huggingface.co/api/models?sort=trendingScore`; no Hugging Face connector.
- Station cards are dropped entirely; sources are Hacker News, lobste.rs, Bluesky, YouTube RSS and Hugging Face only.
- No agent-system branch name, key, token or private path reaches the repo or the deploy (checked with `git grep`).
- The Routine is drafted, not created; when created it runs 2/day with `notifications {push:true}`, its model set to opus with `update_trigger` and confirmed with `list_triggers`.
- YouTube cards ship thumbnails with tap-to-play; muted autoplay is progressive enhancement after the tap.
- Named-path commits only; nothing posts, nothing spends, nothing publishes beyond the Vercel deploy.

## 10. Review round

After the first build, four Opus reviewers (iOS and UX, service worker and security, feed builder and brief compliance, and an independent ranking judge) read the code. Fixed from their findings: `window.open` with the `noopener` feature returns null by spec, so every tap would have navigated the standalone app away (now the opener is severed by hand); feed URLs are validated to http(s) at build and at render, and a Content Security Policy is set; the feed cache honours a reload request, revalidates inside `waitUntil`, only ever replaces the cached feed with a newer JSON build, and navigation has a 3-second timeout before the cached shell; the session's thumbnails are warmed into the media cache; mutes are keyed per YouTube channel; mute and "less like this" remove cards in place without a scroll jump, and the long-press acts on release; card bodies scroll when Dynamic Type or landscape overflows them; the strip is dark in both palettes so the translucent status bar stays readable; tap targets are 44 px; the toast sits above the action row; the install sheet records any dismissal; the builder refuses to publish an empty fetch and prunes scores by age rather than presence, guards each item's date, honours Bluesky post labels and skips reposts, scopes interests to the top list, matches score-low phrases on word boundaries, prefers the discussion-bearing copy of a duplicate link, and no longer ships engagement counts or the dedupe key. The ranking judge scored all candidates blind; 22 scores were adjusted toward its reading (Hugging Face model cards down to 0-3, two AI-maths items and a technical "mental model" post down, a promo down to 2).

## Appendix A. Drafted Routine (not created; session 3 creates it after Johan says go)

```
create_trigger({
  name: "THIRTY rebuild",
  create_new_session_on_fire: true,
  cron_expression: "0 4,15 * * *",   // 06:00 and 17:00 Africa/Johannesburg (UTC+2) as UTC
  connectors: ["Vercel"],
  notifications: { push: true },
  initiation: "human_request",
  prompt: "Continue THIRTY at johancilliers22/thirty (add_repo access=push, clone, read README.md 'Rebuild contract' and DESIGN.md section 7). Run `npm ci` then `node scripts/build-feed.mjs --unscored`. If it exits non-zero, stop and report which sources failed; do not commit. Read interests.md and data/candidates.json and write data/scores.json entries {score 0-10, reason one line} for every id the --unscored list printed, using the rubric in DESIGN.md section 7. Run `node scripts/build-feed.mjs --offline`. Commit by named path only: git add data/scores.json data/candidates.json public/feed.json, commit 'Rebuild feed <UTC date>', push origin main (Vercel deploys main on push). With the Vercel connector, confirm the newest production deployment for project thirty is READY and report its URL, the item count, the count of newly scored items and the top five cards with reasons. Never git add -A, never touch interests.md or sources.json, never create triggers, nothing posts anywhere else."
})
// then: update_trigger({ trigger_id, model: "opus" }) and list_triggers() to confirm the model.
```
