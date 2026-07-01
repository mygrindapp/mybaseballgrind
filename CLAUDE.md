# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Who you're working with

**Coach Young**, founder of Young's Baseball Group (YBG) and MyGrind. 35+ years coaching experience. Based in Santa Clarita Valley, California. Always address him as "Coach Young."

## Critical tooling rule — read before editing anything

**NEVER use the GitHub web editor's find/replace on `signup.html` or `onboarding.html`.** Both files are very long and that workflow has caused **4 confirmed file-corruption events** (April 30). All edits to these files go through Claude Code only.

**Before editing either file, verify the live deployed version at `raw.githubusercontent.com` first** — the local copy may not match what's actually deployed. Don't trust local-matches-deployed.

## Do-not rules — hard stops

- Do **not** launch publicly or drive traffic until a real-user end-to-end walk is complete.
- Do **not** upgrade Twilio from trial without a conscious decision.
- Do **not** submit Twilio toll-free verification while tired or rushed.
- Do **not** reproduce full long files in chat — surgical edits only.
- Do **not** ship any fix without a structural sanity check (walk every screen, not just the changed feature).
- Do **not** trust that the local file matches deployed — always check `raw.githubusercontent.com` first.

## Verification protocol after every code edit

1. Check `raw.githubusercontent.com` to confirm the file deployed.
2. Walk every screen in the affected file.
3. Test on phone-width viewport.
4. Look for duplicate elements, missing buttons, broken spacing.

## Current build status

- **Phase 3a** (Skeleton + Auth) — COMPLETE
- **Phase 3b** (Twilio SDK + Live Send) — code complete, BLOCKED on toll-free verification pending
- **Phase 3c** (Rate Limiting) — COMPLETE + VERIFIED
- **Phase 3d** (Twilio Lookup pre-check) — COMPLETE (2026-05-02). `lib/lookup.js` rejects landlines / VoIP / invalid numbers before rate-limit counters fire.
- **Business Plan** — 14/14 sections COMPLETE
- **Locked Decisions** — 16 LOCKED (source of truth in Notion)

## Pricing (locked)

**Single plan** (1 player):
- $9.99/month per player
- $99/year per player (annual is pre-selected as recommended per **Decision #8 v2**)

**Family plan** (2-3 players, locked 2026-05-02):
- $14.99/month flat for the household
- $149.99/year flat for the household
- Hard-capped at 3 player slots
- Slot-lock: once invites send (Screen 7 entry), player slots can no longer be swapped without contacting `coach@mygrindapp.com`
- Phone uniqueness within a plan: no two players can share the same real phone (fallback / parent-device flag exempted)

Both plans:
- 30-day free trial, card on file at signup (no charge until the trial ends; changed from 14-day/no-card on 2026-07-01)
- Annual pre-selected by default (Decision #8 v2)

## Brand voice

- **Use:** investment, support, peace of mind, growth.
- **Avoid:** grind harder, elite, beast mode.
- **Tone:** parent-friendly, no-pressure, trust-first.

## Source of truth

All strategic decisions live in **Notion → "MyGrind Worldwide Launch HQ"**. 16 locked decisions. When code comments cite a Decision number or Phase, Notion is authoritative. **When in doubt, check Notion before making any architectural change.**

## Repo shape

Hybrid static-site + Vercel serverless backend. The frontend is large hand-authored HTML files (CSS + vanilla JS inlined, no build step, no framework). The backend is a set of Vercel serverless functions under `api/` (auth codes, Stripe checkout + webhook, managed minors, feedback, crons, admin) with shared helpers in `lib/`. There is no test suite, lint config, or build script.

```
index.html                   Marketing landing page (SEO/JSON-LD, pricing, FAQ)
legacy-app.html              Redirect shell → signup.html
signup.html                  Parent signup flow (~3700 lines, 7 screens)
onboarding.html              Player kid-side onboarding (Phase 4, ~1300 lines)
softball.html                The actual journal app (~9500 lines, the product)
mg-config.js                 URL/QR/share-link override loaded by the app
privacy.html, terms.html     Static legal
api/send-invite.js           Vercel serverless: Twilio SMS invite
lib/rate-limit.js            Redis-backed rate limiter used by the API
package.json                 ESM, Node ≥18, deps: twilio, ioredis
```

`vercel.json` (headers, rewrites, crons) and `.gitignore` are checked in; no `.env*` is (and none should be). Remote: `github.com/mygrindapp/mybaseballgrind`. Production domain: `mygrindapp.com` (Vercel). Legacy app URL: `youngsbaseball.github.io/mybaseballgrind` (still referenced from inside `softball.html`).

## Commands

There is no build, lint, or test tooling. Workflow is:

- **Run locally** — open the HTML files directly in a browser, or `python3 -m http.server` from the repo root. The frontend never calls `/api/*` from disk in the current phase, so a static server is enough for UI work.
- **Backend dev** — `vercel dev` (Vercel CLI) to serve `api/send-invite.js` locally. Required env: `REDIS_URL`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `SMS_DRY_RUN`.
- **Deploy** — `git push` to `main`; Vercel auto-deploys.
- **Install deps** — `npm install` (only needed if you touch `api/` or `lib/`).

## Architecture

### Multi-page user funnel

Each HTML file is a self-contained SPA. There is no shared JS module — state is passed between pages via `localStorage` and URL query params. Reading any one file in isolation will miss the cross-file flow:

1. **`index.html`** — the full marketing landing page (hero, pricing, FAQ, JSON-LD, newsletter capture); light/white theme is the default. **`legacy-app.html`** — meta-refresh + JS redirect shell to `signup.html` for old bookmarks; don't add logic there.
2. **`signup.html`** — parent-side signup. 7 screens, navigated via `go(n)` / `goNext()`. State persisted to `localStorage`. Currently labeled "Phase 2" in code: front-end only, no backend calls. Comments throughout reference future phases (Phase 3 = SMS, Phase 5 = Stripe). Treat the `// Phase N will...` comments as load-bearing TODOs, not stale notes.
3. **`onboarding.html`** — player ("kid") onboarding. Reached via SMS link (`?name=Sofia`) or fallback (`?name=Sofia&fallback=1`). Per the inline header, this file was deliberately stripped of Stripe/Mailchimp/Firebase/trial-state plumbing in Decision #13 (April 27 PM). Do not re-introduce that plumbing without checking with the user.
4. **`softball.html`** — the real app: journal, stats (AVG/OBP/SLG/ERA), 12-month training plan, goals, arm care, share/QR. Persists everything to `localStorage` via `loadState()` / `saveState()` / `store()` / `retrieve()`. Trial/paywall logic lives in `checkAccess()` → `validateSession()` and a few `show*()` functions around line 3500–3700. Stripe payment URLs (`STRIPE_MONTHLY_URL`, `STRIPE_ANNUAL_URL`, `STRIPE_TEAM_SPONSOR_URL`) are hardcoded `buy.stripe.com` links — these are real production checkouts, treat as sensitive constants.
5. **`mg-config.js`** — runtime override script, loaded *after* `softball.html` to monkey-patch `window.APP_URL`, `window.SHARE_URL`, `window.copyReferralLink`, `window.shareNative`, `initQR`, and `qrGenerated`. Its purpose is to redirect all share/QR surfaces from the legacy github.io URL to `mygrindapp.com/onboarding.html`. If you change share-related identifiers in `softball.html`, also update the patches in `mg-config.js`.

### Backend: SMS invite

`api/send-invite.js` is the only serverless function. Flow on `POST`:

1. CORS, validate body shape (`parentName`, `playerName`, `playerPhone`, `sport`, `signupSessionId`).
2. Normalize phone to E.164 (`toE164`, US-only: 10 digits or 11 starting with `1`).
3. **`checkIpLimit(ip)`** then **`checkPhoneLimit(phone)`** (from `lib/rate-limit.js`).
4. **`recordSend(ip, phone)` fires *before* the Twilio call** ("Option C" in the comments). This is intentional — the counter increments on attempt, not success, so a Twilio outage cannot be used to bypass the limiter. Do not "fix" this by moving `recordSend` after success.
5. If `process.env.SMS_DRY_RUN !== 'false'`, log and return a fake `smsSid`. **`SMS_DRY_RUN` defaults to ON** (sends are blocked unless the env var is explicitly `'false'`).
6. Otherwise create a Twilio message and return its SID.

The SMS body is built by `buildSmsBody({...})` and is constrained to **GSM-7 only** (no em-dashes, no smart quotes) so it fits in one segment. Any copy edit must respect this.

The "locked spec" referenced in `api/send-invite.js` headers is in Notion ("🛠️ Phase 3 — Twilio SMS Backend Architecture"); rate-limit numbers (3/hr IP, 10/day IP, 2/24h phone) live there.

### Rate limiter (`lib/rate-limit.js`)

- ioredis singleton against Vercel's Redis Cloud (`REDIS_URL`). Singleton pattern matters because warm Vercel functions reuse the process.
- **Privacy invariant: never store raw IPs or raw phone numbers.** The module hashes both with SHA-256 before keying Redis. Preserve this when extending.
- **Fail-open on Redis errors.** Every helper returns `{ ok: true }` (or silently no-ops in `recordSend`) if Redis is unreachable or `REDIS_URL` is unset. Better to allow a legit signup during an outage than to block all signups. Don't change this to fail-closed without an explicit ask.
- Keys are hour-bucketed and day-bucketed (`Math.floor(Date.now() / msPerBucket)`); each `INCR` is paired with `EXPIRE` via a pipeline so concurrent requests can't double-count.

## Conventions worth knowing

- **Phase markers in comments are real.** Code comments cite phases (Phase 2/3/3c/4/5/6/7) and decision numbers (e.g. "Decision #13"). The locked spec lives in Notion; treat these as the authoritative product/staging context, not noise.
- **Single-file SPAs by design.** Don't extract shared JS into modules across HTML files unless asked — the project deliberately keeps each page standalone for hosting simplicity.
- **`localStorage` is the source of truth client-side.** There is no auth/session backend yet. `getDeviceFingerprint`, `validateSession`, and `flagTampered` in `softball.html` are the closest thing to an integrity check.
- **Two domain names coexist** (`mygrindapp.com` and `youngsbaseball.github.io/mybaseballgrind`). When changing URLs, grep both — `softball.html` still has hardcoded github.io URLs that `mg-config.js` overrides at runtime.
