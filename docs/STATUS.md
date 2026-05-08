# 📊 My Grind — Current Status

*Last updated: 2026-05-08. Update this file at the end of every coding session.*

---

## 🌐 Where Things Live

| Surface | URL | Hosting | File |
|---|---|---|---|
| Pre-launch waitlist landing | https://mygrindapp.com | Vercel | `index.html` |
| Parent signup flow (8 screens) | https://mygrindapp.com/signup.html | Vercel | `signup.html` |
| Player onboarding | https://mygrindapp.com/onboarding.html | Vercel | `onboarding.html` |
| The journal app (live for beta) | https://mygrindapp.com/softball.html | Vercel | `softball.html` |
| Legacy app URL (still referenced inside `softball.html`) | https://youngsbaseball.github.io/mybaseballgrind/ | GitHub Pages | served via `mg-config.js` runtime override |
| SMS backend | `/api/send-invite` | Vercel serverless | `api/send-invite.js` |
| Static legal | mygrindapp.com/privacy.html, /terms.html | Vercel | `privacy.html`, `terms.html` |

- **Repo**: https://github.com/youngsbaseball/mybaseballgrind
- **Domain (live)**: mygrindapp.com (Vercel) — apex redirects to www
- **Cloud backend**: Firebase (`my-grind-b8486`) — Spark plan (free) — used for cloud sync of profile/entries/goals from `softball.html`
- **Mailchimp waitlist**: audience `73280b4c02e9bc56c7e633892`, tag `2216797` (subscribe form on `index.html` posts via JSONP to us8.list-manage.com)
- **Tech**: Hand-authored HTML files (CSS + vanilla JS inlined, no build step, no framework), Vercel serverless backend (Node ≥18, ESM), Redis-backed rate limiter

## 🛠️ Tech Decisions

- **No build step** — edits land directly. Pro: zero infra. Con: no linting, no automatic tests.
- **Single-file SPAs by design** — each HTML file is self-contained. State passes between files via `localStorage` and URL query params (`?name=Sofia&fallback=1`).
- **Service worker cache version** in `softball.html` — bump `ybg-mygrind-vN` every time you ship a meaningful update so users get fresh content.
- **`localStorage` is source of truth client-side** in `softball.html` (no auth/session backend yet for the journal app itself; signup flow's `api/send-invite.js` is the only serverless function so far).

## 🧱 Phase Status (Notion is authoritative — see "MyGrind Worldwide Launch HQ")

- **Phase 2 — Parent Signup Flow** — front-end complete (8 screens in `signup.html`). No backend wiring yet.
- **Phase 3a (Skeleton + Auth)** — COMPLETE
- **Phase 3b (Twilio SDK + Live Send)** — code complete, BLOCKED on toll-free verification pending
- **Phase 3c (Rate Limiting)** — COMPLETE + VERIFIED (Redis-backed, hashed IP/phone, fail-open)
- **Phase 3d (Twilio Lookup pre-check)** — COMPLETE (2026-05-02). `lib/lookup.js` runs Twilio Lookup v2 between E.164 normalization and rate-limit checks; rejects landlines, VoIP, and invalid numbers with friendly messages before any send budget is burned. Fail-open on Lookup outage.
- **Phase 4 — Player Onboarding** — `onboarding.html` shipped (per Decision #13: stripped of Stripe/Mailchimp/Firebase, just localStorage)
- **Phase 5 — Stripe wiring** — COMPLETE (2026-05-05). Step 1 (skip-trial Stripe redirect) shipped 2026-05-03. Steps 2-4 shipped 2026-05-05: webhook (`api/stripe-webhook.js`) verifies signatures and updates Redis subscription store on subscription events; Pay button on signup.html Screen 8 redirects to live Payment Links; softball.html syncs paid status from `/api/get-subscription` on every load. Stripe webhook destination "fascinating-oasis" live in Workbench listening to 5 events. Real subscriptions now flip `isPaid` automatically.
- **Phase 6 — Share + Settings buttons on signup dashboard** — COMPLETE (2026-05-02). Real modals replace the placeholder alerts. Share modal has copy-link + Web Share API + pre-written caption. Settings modal shows read-only account summary (name, email, phone, plan, players) + a support-email link for changes (self-serve editing lands when Phase 5 backend account management ships).
- **Family pricing tier** — COMPLETE (2026-05-02; price reconciled 2026-05-06 to match live Stripe link). $149.99/yr · $14.99/mo flat for 2-3 players in one household, alongside the existing Single tier ($99/yr · $9.99/mo per player). Anti-abuse stack: hard cap at 3 slots, slot-lock at first SMS-send, per-plan phone uniqueness, single-parent invite path (already in place).
- **Phase 7 — Player dashboard** — softball.html IS the live player dashboard; the old onboarding S14 holding-screen overlay was deleted 2026-05-07. Dashboard walkthrough STARTED — Dashboard tab + Daily Journal tab header partially narrated. Tomorrow's queue: first-time profile-then-journal flow, hide-pay-on-player-profile, then narrate remaining tabs.
- **Phase 7b V1 — Coach feedback loop** — COMPLETE (2026-05-04). End-to-end: player → SMS magic link → coach-reply.html → SMS player + parent dashboard card. Redis-backed `lib/feedback-store.js`, 4 API endpoints, 32-hex token auth, 90-day TTL. SMS via Twilio (DRY_RUN until TFV approves).
- **Phase 7b V1.5 — Parent weekly email digest** — COMPLETE in TEST MODE (2026-05-05). Vercel cron `/api/cron/weekly-digest` fires Mondays at 14:00 UTC (~7am PDT), scans Redis for active parent emails, sends warm-dark branded HTML digest via Resend. All emails redirected to youngsbaseball@gmail.com via `WEEKLY_DIGEST_TEST_EMAIL` env until `mygrindapp.com` is verified in Resend (DNS migration deferred). Sender: `onboarding@resend.dev`.
- **Adult self-signup funnel (Scope X)** — COMPLETE (2026-05-06). `signup.html` now opens with a Screen 0 audience picker ("My Athlete" / "Myself"). Self path branches via `state.signupFor='self'`: relabeled copy on Screens 1-4 (`applySelfLabels(n)`), playerCount question hidden on Screen 3, Screen 6 auto-fills + skips to Screen 7. URL handoff `?self=1` to `onboarding.html` triggers self-aware PIN screen + welcome + end-of-flow copy. Scope Y polish (Screen 8 dashboard + S14 deeper kid-coded copy) deferred.
- **Multi-sport platform Phase 1** — COMPLETE (2026-05-06). `softball.html` refactored into a sport-aware shell themed per `data-sport`. Central `SPORTS` config object (baseball/softball/both) with `getSportConfig()` helper. 165 hardcoded pink color refs → `var(--gold)` family. 16 hardcoded 🥎 → ⚾ HTML defaults (DOM walker swaps per sport). Bidirectional `applyBallEmoji()`. New `window.setActiveSport(s)` global re-themes live. Multi-sport toggle UI in dashboard header for `family=both` users (live ⚾↔🥎 swap, no reload). Recipe doc `docs/ADD_A_SPORT.md` makes adding football/volleyball/etc. a ~15-minute job. Phase 2 (sport-specific drill content) + Phase 3 (per-sport landing pages) deferred.
- **Promo code system** — COMPLETE (2026-05-06). Collapsible "Have a promo code?" gold-pilled button on Screen 5 of `signup.html`. Persists to `state.promoCode`. New `buildCheckoutUrl()` helper appends `prefilled_promo_code=` + `prefilled_email=` to Stripe Payment Link URL. Both checkout entry points (skip-trial + dashboard pay-early) use it.
- **SEO foundation** — COMPLETE (2026-05-07 PM). Title rewritten "MyGrind — Baseball & Softball Training Journal App" (51 chars, brand + sport keywords). Description, Open Graph, Twitter Card all wired with explicit width/height/alt/type/locale. JSON-LD `@graph` on `index.html` with 3 nodes — Organization, WebSite, SoftwareApplication (with 3 Offer prices). 1200×630 OG card at `/assets/og-card.png` (Canva-generated, brand-kit aligned, LinkedIn preview verified). Vercel Web Analytics live + collecting on all 6 public pages (cookieless, privacy.html §11 compliant). Google Search Console URL-prefix property verified via `/google826fc67b2dde2efa.html`; sitemap submitted with **Success** status. Indexation timeline: 2-7 days first crawls, 2-4 weeks branded "MyGrind app" surfaces, 4-8 weeks full maturity. Single-reference doc lives at `docs/ANALYTICS.md`.
- **Business Plan** — 14/14 sections COMPLETE
- **23 Locked Decisions** (1 added 2026-05-07: #23 onboarding completion auto-grants softball.html trial access; previous 3 added 2026-05-06: #20 multi-sport architecture, #21 Family Annual = $149.99, #22 self-signup is a branch in signup.html) — source of truth in Notion

## ✅ Features Shipped (`softball.html` — the journal app)

### Core
- [x] Daily Journal — log games, practices, reflections, instructor sessions
- [x] Game stats with auto-calculated AVG / OBP / SLG / ERA
- [x] Practice rep counter (swings, ground balls, throws, pitches)
- [x] My Stats season totals (auto-populated from journal)
- [x] Goals tracker (3 measurable goals)
- [x] 12-month Training Calendar with weekly prescriptions
- [x] Academics (5 core subjects + custom classes)
- [x] Profile (positions, height, weight, photo, sport)
- [x] Team panel (coaches/players)
- [x] Streak tracking + milestone celebrations
- [x] Daily inspirational quote on Dashboard
- [x] Coach/Parent comment logging on entries
- [x] Daily affirmation banner (60 affirmations, rotates by day-of-year)
- [x] PWA install prompt + offline support
- [x] **Backup & Restore** — JSON export/import of all `ybg_*` data in Settings tab (re-shipped 2026-05-02)
- [x] **Backup nudge** — non-blocking banner appears when user has 3+ entries and no backup in 7+ days (re-shipped 2026-05-02)

### Cloud Sync (Firebase)
- [x] Sign in with Google (Firebase Auth)
- [x] Manual "Save to Cloud" / "Restore from Cloud" buttons
- [x] Cross-device data recovery
- [x] Per-user privacy via Firestore rules

### Sport Theming
- [x] Sport picker on trial signup (Baseball / Softball / Both)
- [x] Pink palette + softball quotes for softball mode
- [x] 20 softball-specific quotes
- [x] Universal "NO GRADES · NO GAME" banner (sport-neutral)

### Trial / Subscription
- [x] 7-day free trial (auto-starts on signup)
- [x] Email-based access
- [x] Stripe integration (live `buy.stripe.com` URLs hardcoded in `softball.html`)
- [x] Team Coach plan ($29.99/yr) and Team Sponsor plan ($300/yr) options

### Tabs (in order)
1. ⚾ Dashboard
2. 📓 Daily Journal
3. 📊 My Stats
4. 🏆 Goals
5. 📚 Academics
6. 📅 Training Calendar
7. 👥 Team
8. 👤 My Profile
9. 📲 Share
10. ⚙️ Settings (now includes Backup & Restore)

### Active beta users
- ~7 (per last count — verify in Firebase Auth dashboard if you need a fresh number)

---

## 🐛 Known Issues / Followups

*Add discovered bugs to `docs/ROADMAP.md`. This list is for STABLE issues we've decided to defer.*

- ⚠️ **Two-host situation** — `mygrindapp.com` is the primary, `youngsbaseball.github.io/mybaseballgrind/` is legacy. `softball.html` still has hardcoded github.io URLs that `mg-config.js` overrides at runtime. When changing URLs, grep both.
- ⚠️ "Hover" issue on Daily Journal top dropdown reported — needs clarification (no specifics yet)
- ⚠️ Softball image showing where a baseball should — needs screenshot to identify
- ⚠️ Duplicate `escapeHtml()` function in `signup.html` (defined at lines 3264 + 3417) — second wins, both nearly identical. Maintenance trap.
- ⚠️ SMS preview in `signup.html` (line ~3344) shows `mygrind.app/start/abc123` — fake URL with placeholder token. Real Twilio send (when 3b unblocks) will generate a different link, but the preview is misleading to parents.
<!-- Share + Settings buttons fixed 2026-05-02 (Phase 6 shipped) — alerts replaced with real modals. -->

---

## 📈 Metrics to Track (when you're ready)

- Number of waitlist signups (Mailchimp dashboard, audience `73280b4c02e9bc56c7e633892`)
- UTM source breakdown (which channel converted best)
- Number of active app users (Firebase Auth dashboard)
- Number of daily journal entries created (Firestore queries)
- Backup adoption % (count of `ybg_last_backup` keys via cloud-sync if/when we wire that)
- Trial → paid conversion rate (Stripe dashboard)

**Vercel Web Analytics** is now live (2026-05-07) — see `docs/ANALYTICS.md` for the full reference doc covering visitors, free trials, paid subscribers, and Search Console indexation. Weekly + monthly review checklists included.
