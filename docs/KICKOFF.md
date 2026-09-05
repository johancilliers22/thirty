# THIRTY feed — kickoff pack (hub: the laptop console session, 2026-09-05)

Idea 1 of HOLIDAY-2026-09. Tier **verified**, so the starter prompt below is the pack's own, unchanged apart
from the leading `ultracode.` explained in §0. The
"fully polished" additions Johan asked for on 2026-09-05 are appended as a clearly separated block; they extend
the starter scope and never override its CORRECTION line. Every hub claim below names its source; where the
pack is silent it says so.

## 0. What this session is, and is not

- **Where it runs:** a *cloud* session. The pack's two launch paths are `claude --cloud "<the prompt>"` from
  a clone on the laptop, or claude.ai/code with the repo attached (holiday-builds README, "Where a build
  actually runs"; LAPTOP-TODAY Step 3). For THIRTY use the second: the prompt attaches the new repo itself with
  `add_repo`, and it must start in an environment that already has `agent-system` attached so it can read the
  starter file. The skeptics' sessions ran in `env_01VZrMPfRDeWnahjHS5TAN7j`, which sources agent-system,
  wefitkit, cs2-trading, dilzy and origin (thirty-feed.md, night-shift.md). Johan's own screenshot of the
  Claude Desktop app on 2026-09-05 shows a cloud session in the app's Code tab on an environment displayed as
  **Default** with those same five repos attached; nothing ties that display name to the id, so confirm in
  the environment selector that agent-system is listed before pasting. `origin` is cloned too and
  must never be pushed over. Not a local session on the laptop: the laptop is the console, not an executor
  (Coding/CLAUDE.md), and a Desktop-hosted *local* session breaks the next Desktop update.
- **Permission mode:** *Auto*. Cloud sessions reject `bypassPermissions` (LAPTOP-TODAY Step 3); expect a few
  prompts.
- **Model: Opus 5, all three sessions and the Routine.** The report's ruling table: "Games, PWAs, static
  sites, feeds → Opus 5" and "Screenshot QA loops → Opus 5; the vision gain is not load-bearing"; its
  "Answer first" paragraph allocates Fable to the i2v lab's first run and one hang-diagnosis night and nothing
  else (BUILD-IDEAS, the paragraph above §1); the value skeptic says "Build on opus[1m] + ultracode" (thirty-feed.md). Fable 5.1
  stops at 50% of the weekly pool it shares with Opus (BUILD-IDEAS §1); how much one Fable request draws from
  a Max plan is explicitly unverified, only the 2x API price ratio is published (BUILD-IDEAS §5); the estate
  has already hit the Fable cap once mid-session and reverted to Opus (Coding/CLAUDE.md; vault daily note
  2026-09-02). Addition B below fans out research subagents, and on Fable those draw the same 50% allowance
  (Coding/CLAUDE.md). If Johan overrides this himself: Fable availability in cloud *Cowork* sessions is on
  BUILD-IDEAS §5's could-not-verify list and availability in a claude.ai/code session is not recorded either
  way, so check the model picker before relying on it. An unattended Fable turn that needs credit consent
  waits 5 min and ends silently (BUILD-IDEAS §1).
- **ultracode:** the word sits at the head of the prompt block as a hub instruction to the model, not as a
  setting. The pack records three ways to set it: `"ultracode": true` in a settings file, `--settings`, or
  an SDK control request (HOLIDAY-2026-09-CORRECTIONS.md §5, which cites "the model-config documentation";
  HOLIDAY-2026-09-surface-config.md quotes that page, code.claude.com/docs/en/model-config, directly), plus
  `/effort` in a session. Whether a cloud session honours a committed key is explicitly unverified
  (CORRECTIONS §8: "Do not assume it"). agent-system's own committed `.claude/settings.json` already carries
  `"ultracode": true` (night-shift.md), so a session that clones it may already be there. Run `/status` in
  the session and read the effort line rather than assuming either way.
- **The hub:** the laptop console session logs this mission as `fired` in `vault/10-Missions/_Mission log.md`,
  holds this pack, and verifies "Done when" itself on return. A cloud session cannot see the laptop
  (docs/setup/07-CLOUD-HANDOFF.md), and no cloud-to-laptop messaging channel has been tested, so do not rely
  on one: Johan pastes the session's final report back into the console, or the console reads the pushed repo
  with `gh` (present on the laptop). A session saying it finished is `claims-done`, not done (holiday-builds
  README).

## 1. Before pasting (Johan, from the phone, about two minutes)

1. Create the **empty, public** repo `johancilliers22/thirty` on github.com (no README, no .gitignore). Public
   because a fresh-session Routine has no repo parameter and must fetch it itself; the feed is public links
   anyway (thirty-feed.md, feasibility skeptic). If it must be private, grant the Claude GitHub App access to
   it from the GitHub app instead.
2. Have the interests block ready: 10-20 lines, one interest per line, specific ("Claude Code agent
   orchestration", "image and video gen model pricing", "three.js and Godot", "Instagram growth tactics",
   "South Africa travel"). It is pasted at the end of the prompt and later committed as `interests.md`.
3. Check `/status` (or claude.ai/settings/usage) so the first session is not the one that hits the cap.
4. Nothing else. No keys: every v1 source is keyless and verified reachable from the VM on 2026-09-02.

## 2. What to attach

Nothing is required. A claude.ai/code session clones the repo's default branch (Coding/CLAUDE.md) and the pack
is on `master` (LAPTOP-TODAY Step 0), so the clone already carries `docs/holiday-builds/thirty-feed.md` (the
starter file with both skeptics' findings and the risks) and `docs/diagnostics/HOLIDAY-2026-09-BUILD-IDEAS.md`.
The prompt tells the session to read them from the clone. Attach this file too if starting from the phone, so
the session has the additions block verbatim. The `brain/` canon is Luna-specific and not relevant to THIRTY;
do not attach it.

## 3. Session 1 prompt — paste whole

```
ultracode. Build THIRTY, my personal short-form feed PWA — the thing I open on my iPhone instead of TikTok. Hard constraints: standalone project in a NEW repo (I created an empty repo johancilliers22/thirty on GitHub — attach it with add_repo access=push and push there); write NOTHING into agent-system; no paid APIs, no API keys, no spending, no publishing anything other than my private Vercel deploy. v1 sources (all verified reachable from this VM with no auth): Hacker News Firebase API topstories (top 60), lobste.rs/hottest.json, Bluesky public.api.bsky.app what's-hot feed plus getAuthorFeed for handles I will list, YouTube channel RSS (youtube.com/feeds/videos.xml?channel_id=) for channels I will list, and Hugging Face trending models via the Hugging Face connector (hf_fs ls hf://models/trending). Deliver: (1) scripts/build-feed.mjs that fetches, dedupes by URL, and writes public/feed.json; (2) a Vite static PWA: one card per screen, CSS scroll-snap vertical, swipe up = next, tap = open source in a new tab, long-press = mute that source 7 days; YouTube cards embed youtube-nocookie.com/embed/ID with playsinline and muted autoplay; manifest.webmanifest with display standalone, portrait, apple-touch-icon; seen/muted state in localStorage wrapped in try/catch; a header strip showing 'built N hours ago'; light and dark palettes; (3) ranking: read the interests block I will paste below and score every item 0-10 for 'worth 30 seconds of Johan's attention' with a one-line reason — do this yourself in this session (no API key), write score and reason into feed.json, sort descending; (4) verify with Playwright at 390x844 (iPhone) and 430x932, screenshot the first three cards and show them to me; (5) deploy with the Vercel connector and give me the URL plus the exact iPhone steps (Share sheet > Add to Home Screen). Then DRAFT (do not create until I say go) a Routine via create_trigger: fresh session, every 6 hours, model opus, connectors Vercel and Hugging Face, whose prompt re-runs build-feed, re-ranks, and redeploys. Ask me nothing; make reasonable choices and list them at the end.

My interests: <paste 10-20 lines: AI agents/Claude Code, image+video gen models and pricing, three.js/Godot/Roblox dev, Instagram growth tactics, South Africa travel, ...>
CORRECTION FROM VERIFICATION: Hugging Face trending is reachable keyless at https://huggingface.co/api/models?sort=trendingScore&limit=N from build-feed.mjs (a Node script cannot call connectors anyway), so drop the Hugging Face connector; create_trigger has no model parameter, so set opus with update_trigger after creation and confirm with list_triggers; the production Vercel URL stays public on Hobby, so station cards are dropped entirely from v1 — the report's source list is HN, lobste.rs, Bluesky RSS, YouTube RSS and Hugging Face only, and agent-system branch names must never reach a public Vercel URL; the Routine must be created from this environment or the feed hosts added to Allowed domains, and the new repo must be public or granted to the Claude GitHub App; keep the schedule to 2/day and add notifications {push:true}; ship YouTube thumbnails with tap-to-play and treat muted autoplay as progressive enhancement.

ADDITIONS FROM THE HUB (Johan asked on 2026-09-05 for a fully polished phone app, not an MVP; these extend the scope above and never override the CORRECTION line):
A. Read first, from the agent-system clone in this environment: docs/holiday-builds/thirty-feed.md (both skeptics' findings and the Risks section are binding), then docs/holiday-builds/README.md "Rules that still apply on holiday". Do not touch anything else in agent-system.
B. Research before code, as parallel researcher subagents on opus, each answering from primary sources it can fetch (developer.apple.com, webkit.org, web.dev, MDN, vercel.com, code.claude.com) and quoting the line it relies on: (1) iOS Home Screen web-app facts as of today — storage eviction for installed web apps, Web Push after Add to Home Screen, safe-area insets, -webkit-touch-callout and the long-press callout conflict, scroll-snap behaviour in standalone mode, dvh vs vh, absence of pull-to-refresh, whether muted autoplay works inside a standalone shell; (2) feed design that is the opposite of TikTok — interest-matched ranking with a visible one-line reason per card, source diversity so no single source can fill the top, a finite session that ends with a "you're done" card after N items rather than an infinite scroll, a "less like this" signal stored locally, no autoplay-next; cite at least two sources on attention and habit design and say which findings you applied; (3) offline-first PWA patterns — service worker precaching the shell, stale-while-revalidate for feed.json, the last 30 cards readable offline, an in-app "new build available" refresh, and export/import of interests, mutes and seen state as a JSON file via the share sheet because Safari can evict storage. Write the reconciled result to DESIGN.md with citations, then build to it. If any researcher cannot verify a claim, DESIGN.md says UNVERIFIED and the build takes the conservative path. This VM is on a trusted allowlist and returns 403 for non-allowlisted hosts (fonts.googleapis.com and api.github.com are both blocked); if a research host 403s, record it in DESIGN.md as unreachable rather than substituting a secondary source, and tell me which hosts to add to Allowed domains.
C. Polish that ships in this session: an install screen for first-time Safari visitors (Share, Add to Home Screen, since iOS has no install prompt); safe-area padding; respect prefers-reduced-motion and prefers-color-scheme; text that scales with the system font size; a per-card "why this score" line and a source chip; a settings sheet that shows the interests block read-only with a Copy button (the Routine reads interests from interests.md in the repo, edited via the GitHub app, so there is no server and nothing to sync); the "built N hours ago" strip turns amber past 14 h (hub's choice, sized so it only fires on a missed run); a Lighthouse run in the VM in mobile mode at 390x844 with CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome (the path that worked for wefitkit; the VM has lighthouse 13.4.1 via npx), reporting performance, accessibility, best-practices and SEO with anything under 90 fixed or explained — Lighthouse removed its PWA category in v12.0.0 (an external fact, not in any pack source; confirm from the Lighthouse changelog in-session), so verify installability by hand instead (manifest fields, display standalone, apple-touch-icon, service worker registered) and state each as pass or fail; do not pull Google Fonts, fonts.googleapis.com is egress-blocked here.
D. Commit interests.md and DESIGN.md to the repo alongside the code. Named-path commits only, never git add -A. Push to johancilliers22/thirty on main.
E. Do not create the Routine, do not create any trigger, do not post or publish beyond the private Vercel deploy. The Routine is drafted only; it is created in session 3 after I say go, on Opus, at 2 runs a day with notifications {push:true}, and its model is set with update_trigger and confirmed with list_triggers.
F. End with a report in this order: the Vercel URL and the exact iPhone install steps; the three Playwright screenshots; the Lighthouse scores and the installability checklist; DESIGN.md's ten most important findings in one line each; every decision you made without asking; the drafted create_trigger call in full; and a short list of what only I can do next.
```

## 4. Session 2 (after Johan has installed it on the iPhone and used it for a day)

Same environment, new session, Opus 5. Paste Johan's device notes and:

```
ultracode. Continue THIRTY at johancilliers22/thirty (add_repo access=push, read DESIGN.md and the last commit first). Fix what my iPhone notes below describe, verify each fix with Playwright at 390x844, and re-run Lighthouse in mobile mode with the CHROME_PATH that worked before. Then tune the ranking against interests.md: show me the top 15 and bottom 15 cards with their reasons and tell me what you changed in the scoring rubric and why. Push named-path commits, redeploy, and end with the URL, screenshots, scores and the decisions list. Do not create the Routine.
My notes: <paste>
```

## 5. Session 3 (Johan says "go" for the Routine)

Times below are the hub's choice; the pack fixes only "2/day, morning + evening SAST" (thirty-feed.md, value
skeptic). BUILD-IDEAS §2's own draft says 05:00 and 17:00 UTC. No leading `ultracode.` here: creating one
trigger is a single mechanical step with nothing to fan out.

```
Continue THIRTY at johancilliers22/thirty. Create the Routine you drafted: fresh session, 2 runs a day (06:00 and 17:00 Africa/Johannesburg), connectors Vercel only, notifications {push:true}, prompt = re-run scripts/build-feed.mjs, re-rank against interests.md, commit public/feed.json by named path, redeploy. Then update_trigger to set model opus, confirm with list_triggers, and paste the confirmation. If this environment cannot reach the feed hosts, stop and tell me which hosts to add to Allowed domains instead of guessing. Do not enable usage credits. Report the daily routine run cap if the UI shows it.
```

## 6. Done when (hub verifies, not the session)

The starter file's four bullets, verbatim, then the hub's additions.

- scripts/build-feed.mjs writes public/feed.json with a score and reason per item, sorted descending, deduped by URL.
- The Vercel URL opens on the iPhone as a standalone Home Screen app with a 'built N hours ago' strip.
- Playwright screenshots at 390x844 and 430x932 of the first three cards are in the reply.
- Source is pushed to johancilliers22/thirty, and a drafted (not created) create_trigger Routine is in the reply with the update_trigger model step noted.
- Additions: DESIGN.md and interests.md are in the repo; Lighthouse performance, accessibility, best-practices and SEO scores are in the reply plus the hand-checked installability list; the feed ends with a "you're done" card; offline reopen shows the last cards.

## 7. Rules that travel with every session

No `git add -A`. Nothing posts, nothing spends, nothing publishes beyond the private Vercel deploy. No key in a prompt, commit or file. Never write into agent-system. The Routine runs on Opus, never Fable. Johan judges quality; a session reports.
