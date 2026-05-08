# 🛣️ My Grind — Roadmap

*Re-prioritize this file at the start of every week. Move shipped items to the bottom and into STATUS.md.*

---

## 🔥 This Week (pick 1 per session)

### P0 — Polish leftover from the audit
1. **Fix duplicate `escapeHtml()` in `signup.html`** — defined at lines 3264 + 3417. Consolidate to one definition. ~5 min.
2. **Fix the SMS preview URL in `signup.html`** — `buildSmsForPlayer()` (line ~3344) hardcodes `mygrind.app/start/abc123`. Should use `mygrindapp.com/onboarding.html?name=...` so the preview matches what Twilio will actually send when Phase 3b unblocks. ~10 min.
<!-- Phase 6 placeholder buttons fixed 2026-05-02 — Share + Settings now open real modals. -->

### P1 — Real-user walks (per CLAUDE.md verification protocol)
4. **Walk every screen of `signup.html` on phone width** — confirm progress dots, validation, back-nav, and SMS preview all behave end-to-end after recent edits.
5. **Walk every screen of `onboarding.html` on phone width** — verify the CSS-corruption fix from 2026-05-02 actually restored sticky progress bar + min-height layout. Especially S0 → S05 (PIN) → S1 → S14 path.
6. **Investigate "hover" issue** — user reported can't hover at top of something on Daily Journal. Need screenshot. Then fix. ~15 min.
7. **Investigate "softball image where baseball should be"** — need screenshot. ~15 min.
8. **Title fallback for Instructor entries** — currently saves as "Entry" if title is hidden. Should auto-fill from instructor name + focus. ~10 min.

---

## 📅 Next 2 Weeks

<!-- Phase 5 SHIPPED 2026-05-05. See "Recently Shipped" below. -->
<!-- Phase 6 SHIPPED 2026-05-02. See "Recently Shipped" below. -->

### P2 — Phase 5 follow-up: full account-edit Settings
Phase 5 backend is now in place. Upgrade the Settings modal from read-only to support inline email/phone updates and a Stripe billing-portal link. Currently the modal points users at support@mygrindapp.com for changes.

### P3 — DNS migration so the digest can email real parents
Move nameservers from Namecheap Web Hosting DNS to Cloudflare → verify `mygrindapp.com` in Resend → set `RESEND_FROM=MyGrind <notifications@mygrindapp.com>` in Vercel → delete `WEEKLY_DIGEST_TEST_EMAIL`. ~1 hr active + 24-48hr propagation. Risk: must capture all current records (A → 216.198.79.1, MX → jellyfish.systems for support@, root SPF) before changing nameservers, or website + support@ email goes down.

### P5 — Phase 7 (Player dashboard)
`onboarding.html` S14 currently shows a holding-screen overlay. Phase 7 is the real player dashboard — likely a stripped-down `softball.html` for the kid side or a new `player-dashboard.html`.

### P6 — Real-time Cloud Sync (Phase B v3)
Third attempt at auto-sync. The first two attempts caused full UI breakage in `softball.html`. **Do this only after P1 done AND with a clear test plan.** Key lesson: don't add a full-screen overlay that can become unclickable. Use a non-blocking pattern.

### P7 — Discoverability ("Why isn't anyone using this?")
If beta users aren't logging entries daily:
- First-run tour (3 quick screens explaining the app)
- Simpler dashboard for new users ("start here" card)
- Clearer call-to-action on the trial signup

---

## 🌅 Future / Maybe

- Push notifications (real lock-screen pushes — requires Firebase Cloud Functions, $25/mo)
- Multi-player accounts (one parent buys, multiple kids use)
- Coach dashboard — see all players' progress in one view
- Photo/video attachments (currently disabled, needs cloud storage)
- GameChanger import via backend proxy (Option 1 currently disabled — Anthropic API blocked by browser CORS, needs server-side endpoint)
- MaxPreps integration (waiting on API access)
- Affirmation push notifications via SMS (Twilio integration)
- Internationalization (Spanish version for the Latino baseball community)

---

## 🐛 Bugs / User Feedback

*When a beta user reports something, jot it here with date and source.*

- (none new yet — start logging when reports come in)

---

## ✅ Recently Shipped (last 7 days)

*Move shipped items here from "This Week" so you have a record of progress.*

### 2026-05-07
- ✅ **SEO foundation complete (NEW phase)** — title/description/OG/Twitter Card rewritten on `index.html` for "MyGrind app" + sport keywords. JSON-LD `@graph` with 3 nodes (Organization + WebSite + SoftwareApplication with 3 Offer prices). 1200×630 OG card at `/assets/og-card.png` generated via Canva using saved brand kit + web logo asset (LinkedIn preview verified). Vercel Web Analytics deployed across all 6 public pages (cookieless, privacy.html §11 compliant). Google Search Console URL-prefix verified via `/google826fc67b2dde2efa.html`; `sitemap.xml` updated with `lastmod` and submitted to Search Console with **Success** status. Commits `1513011`, `d49a88a`, `97b71b3`.
- ✅ **Signup flow polish** — removed redundant `<div class="badge">` from S1–S7 + redundant right-side prog-label spans across all signup screens (consistency: H1 already conveys section). Brightened `.field-label` + `.field-helper` colors; bumped global H1 (42→46, mobile 38→44) and `.sub` (15→16, mobile 17→18). Brand wordmark on Screen 0 promoted from small badge to a proper 26px gold wordmark. ⚡ icon added to Get Started CTA. Phone hardware back-button now navigates between screens via `history.pushState` + `popstate` listener. Promo-aware trial copy: when `MYGRIND6` or `FOREVERYOUNG2026` is entered on Screen 5, the sub line, "What happens at day 14?" promise block, and Screen 7 reminder line all rewrite to match the actual free window (6 months / lifetime); lifetime promos hide the "skip the trial" link entirely. Screen 7 "What's next" block resized to actually be seen. Screen 8 dashboard footer links bigger + brighter; modal typography enlarged; QR code option added to Share modal. Player-card preview brightened with gold-lock signal + 3 new engagement rows (coach feedback, season stats, split games/practices). Journal preview row reframed: visible count + "text stays private". Commits `673c355`, `2848144`, `75ba451`, `4bc9353`, `04f96e5`, `4c426e6`, `fd3df6e`, `8b10d67`, `996a894`.
- ✅ **Onboarding rebuilt with direct softball.html handoff** — `onFinalExit()` now navigates straight to softball.html (was: showed a stale "your dashboard is shipping soon" holding overlay; the entire `showFinalHoldingScreen` function + ~50 lines of dead code deleted). New "Open My Journal →" CTA on S14 replaces the old "Got It — I'll Be Back". Explicit journal-privacy promise added to S14 ("what you write in your journal stays private to you" — mirrors parent-side dashboard preview). Onboarding completion now writes `ybg_softball_access.trialStart = Date.now()` to localStorage so softball.html's `validateSession()` returns `'trial'` instead of bouncing to signup (Locked as **Decision #23**). Killed "You're In ⚾ Baseball" progress-bar text label across all 12 onboarding screens. Bumped "Now it's on you" headline on S13 (34→48px). Commits `fdc1017`, `fdbb8d1`, `d709d66`, `82a1293`, `15a9fab`, `6fed9dc`.
- ✅ **softball.html walkthrough started** — added `youngsbaseball@gmail.com` to `CREATOR_EMAILS` and a permanent `?unlock=1` URL-param creator bypass (handler runs at top of `init()` before the existing creator-flag cleanup, sets both `ybg_creator` AND `ybg_pin_unlocked`). Header logo enlarged + filtered to white (mark 44→60px, wordmark 32→42px). `.section-sub` bumped 13→16px and brightened. Daily Journal panel header cleaned (dropped redundant "Post-Game · Practice · Reflection" subhead + orphan gold-line). Commits `3330538`, `02b638b`, `473c2f3`, `34af5e1`.
- ✅ **`docs/ANALYTICS.md` shipped** — single reference doc covering Vercel Analytics dashboard, Stripe trial/paid views, Google Search Console performance, OpenGraph validator, weekly + monthly review checklists, and automation upgrade paths (weekly Notion pulse, Slack/email digest — both queued, neither built yet). Commit `df4cce3`.
- 📌 **Locked Decision #23** — Player onboarding completion auto-grants softball.html trial access. Previously the trial gate was separate from onboarding (double-gate caused tonight's redirect loop). Now: `onFinalExit()` writes `ybg_softball_access.trialStart` if not already paid/active. Trial-overlay welcome screen still exists for direct-link landings.

### 2026-05-06
- ✅ **Stripe webhook repaired + reconciled** — Vercel "Sensitive" env vars (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PUBLISHABLE_KEY) had been saved with empty values during yesterday's signing-secret rotation, causing all webhook deliveries to return HTTP 500 `server_misconfigured`. Re-pasted via dashboard, redeployed, verified by Aaron Pulley's `customer.subscription.deleted` event auto-recovering to 200 OK at 7:34 AM. Patched all 4 silent-no-op `if (!email) break;` paths in `api/stripe-webhook.js` to `console.warn` with relevant Stripe IDs.
- ✅ **Path A reconciliation (Family pricing)** — discovered live Family Annual payment link charges $149.99/yr (not $149). Updated webhook PRICE_TO_PLAN map to live IDs (`price_1TT69tPm4...` family_monthly, `price_1TT68UPm4...` family_annual). Archived unused canonical `prod_US01TjY0XREZtc` "MyGrind Family" + 2 prices in Stripe. Family copy bumped $149 → $149.99 in 5 places in `signup.html` + 3 doc files (`CLAUDE.md`, `docs/ROADMAP.md`, `docs/STATUS.md`). Derived math fixed: `~$12.42/mo` → `~$12.50/mo`, `save $148/yr` → `save $147/yr`. Locked as **Decision #21**.
- ✅ **softball.html broken paywall fixed** — all 3 `STRIPE_*_URL` constants pointed at INACTIVE Stripe Payment Links (anyone tapping Subscribe got a "this link is no longer active" Stripe error). Updated to use signup.html's working URLs for Single Monthly + Single Annual; created new `plink_1TU78PPm4ermqky4nUSQdVmb` for $300 Team Sponsor.
- ✅ **Adult self-signup funnel (Scope X)** — `signup.html` now opens with a Screen 0 audience picker ("My Athlete" / "Myself"). Self path: `state.signupFor='self'` + `applySelfLabels(n)` swaps copy on Screens 1-4 + playerCount question hidden on Screen 3 + Screen 6 auto-fills player record from parent state and skips to Screen 7. URL handoff `?self=1` to `onboarding.html` triggers self-aware PIN screen, welcome subhead, end-of-flow copy. End-of-onboarding heading swapped from "See you tomorrow" → "Let's grind". Locked as **Decision #22**.
- ✅ **Multi-sport platform Phase 1** — `softball.html` refactored into a sport-aware shell themed per `data-sport`. Central `SPORTS` config (baseball/softball/both with id/label/slug/emoji/accent/accentRgb), `getSportConfig()` helper, exposed via `window.SPORTS` / `window.getSportConfig` / `window.mgSportConfig`. 127 `#D4547A` + 8 `#E87FA0` + 4 `#A03060` + 38 `rgba(212,84,122,X)` → `var(--gold)` family (165 sport-aware refs total). 16 hardcoded 🥎 → ⚾ as HTML defaults; 3 JS-context emoji uses (Notification × 2, drill icon) refactored to runtime `mgSportConfig.emoji`. Bidirectional `applyBallEmoji()`. New `window.setActiveSport(s)` global re-themes live (data-sport attr + theme-color meta + emoji walk + {Sport} template re-render). Multi-sport toggle UI in dashboard header (gold-pilled `⚾ Baseball | 🥎 Softball`, hidden by default, auto-revealed via CSS when `<html data-family-sport="both">`). New `mg_family_sport` localStorage key tracks original signup choice. signup.html `selectFamilySport()` writes the same key so dashboard knows when to surface the toggle. Recipe doc `docs/ADD_A_SPORT.md` makes new sports a ~15-minute job. "Coming soon for: 🏈 🏐 🏀 ⚽" strip on Screen 0 signals expansion. Locked as **Decision #20**.
- ✅ **Promo code system** — collapsible `+ HAVE A PROMO CODE?` gold-pilled button on Screen 5 of `signup.html`. Generic "ENTER CODE" placeholder. Auto-uppercases. Persists to `state.promoCode`. New shared `buildCheckoutUrl()` helper appends `prefilled_promo_code=` + `prefilled_email=` to Stripe Payment Link URL. Both checkout entry points (`onSkipTrialClicked` + `onDashboardPayClicked`) use it. Restore logic on Screen 5 entry pre-fills + auto-expands the dropdown if a code is saved.
- ✅ **`FOREVERYOUNG2026` lifetime free code created** — Stripe coupon `CQoNpVpK` (100% off, duration: forever), promotion code `promo_1TUIriPm4ermqky4RpZVI42Y`. Capped at **10 redemptions**, expires 2030-12-31. For hand-picked recipients. Card still collected at Stripe checkout but never charged.
- ✅ **Trial banner removed from Screen 8 dashboard** in `signup.html`. "14 Days Free" was redundant (parent saw it twice already on Screens 1+5) + risk of any player picking up the parent's phone seeing billing copy.
- ✅ **Defensive horizontal-scroll CSS** in `signup.html` — `min-width: 0` on `.app`/`.screen`/`.screen-body` (fixes flex-child auto-min-width gotcha). `body { max-width: 100vw }`. Plus `img/video/iframe { max-width: 100% }`.
- ✅ **Logo + font bumps** for adult readability on phone — logo 96px → 140px height + 80vw → 90vw on `signup.html` + `onboarding.html`. Phone-only @media block bumps `.sub` 16→17, `.tap-card-desc` 13→15, `.goal-toggle-text` 14→16, `.field-input` 16 (kills iOS zoom-on-focus). Same media block added to `onboarding.html`.
- ✅ **`docs/ADD_A_SPORT.md` recipe doc** — 5-step guide (SPORTS entry + CSS block + signup tile + optional content bundle + optional landing page) with checklist, existing-sports table, and "what won't break per-sport" notes. Targets ~15-minute time-to-add for football, volleyball, basketball, soccer, etc.

### 2026-05-05
- ✅ **Phase 5 Steps 2-4 — Stripe webhook + dashboard pay + subscription sync.** New `api/stripe-webhook.js` (signature-verified, handles 5 event types), new `api/get-subscription.js`, new `lib/subscription-store.js` (Redis CRUD by email, idempotent on `lastEventId`). Dashboard "Pay early" link added to signup.html Screen 8. softball.html now syncs paid status from server on every app load. Webhook destination "fascinating-oasis" live in Stripe Workbench. Commit `bbe6cbf`.
- ✅ **Phase 7b V1.5 — parent weekly email digest** shipped end-to-end and verified by real Gmail delivery. New `lib/email-digest.js` (warm-dark branded HTML, groups by player), new `api/cron/weekly-digest.js` (Vercel cron, SCANs Redis for active parents, sends via Resend, auth via `Bearer ${CRON_SECRET}`), new `vercel.json` (Monday 14:00 UTC schedule). Test mode: all emails redirected to youngsbaseball@gmail.com via `WEEKLY_DIGEST_TEST_EMAIL` env until `mygrindapp.com` is verified in Resend. Sender: `onboarding@resend.dev`. Commits `8881d38`, `bd03455` (chip rendering fix for `{key,label,detail}` objects).
- ✅ **mygrind-visuals skill** added at `~/.claude/skills/mygrind-visuals/SKILL.md`. Orchestrates Higgsfield image + video generation with MyGrind brand guardrails (Warm Dark palette, parent-first voice, banned-words list, model decision tree, prompt template). Auto-fires on any MyGrind visual request.
- ✅ **MyGrind logos uploaded to Higgsfield** — 4 variants (master 5692×3200, web 920×517, mark 902×907, app icon 179×180). Media IDs saved to memory `higgsfield_mygrind_media.md` and wired into the skill so generations default to the right logo for context.
- ✅ **Launch creative generated** — 2× kling3_0 Reels (player finishing BP → opens MyGrind on phone, with voiceover and ambient sound), 2× nano_banana_2 photorealistic IG posts (14-yo boy journaling in dugout at golden hour). Job IDs visible in Higgsfield generations panel.

### 2026-05-04
- ✅ **Phase 7b V1 — end-to-end coach feedback loop** shipped + verified against production. Player → SMS magic link → coach taps → coach-reply.html → coach picks chips + comment → SMS player + parent weekly review card on dashboard. NEW: `lib/feedback-store.js` (Redis-backed CRUD), 4 API endpoints (`feedback-request`, `feedback-get`, `feedback-respond`, `feedback-list`), `coach-reply.html`. Updates: softball.html "💬 New from Coach" dashboard card, signup.html Screen 8 "📋 This Week's Coaching" parent card. Token-gated writes (32-hex secret), 90-day TTL. SMS via Twilio (DRY_RUN until TFV approves). Commit `c00d3a9`.
- ✅ **Phase 7a — player Coach Feedback tab** shipped (mailto V1) earlier in the day; superseded by 7b V1. Commit `bb74304`.
- ✅ **Twilio TFV submitted** 2026-05-04 via console. Privacy §10 + Terms §9 added with full SMS compliance language (consent, frequency, STOP/HELP, retention, carrier disclosure, parent authority for player phone). Calendar check-in May 11 9am PT. `SMS_DRY_RUN=true` stays until Twilio shows APPROVED. Commit `b277a45`.
- ✅ **Logo brand cleanup** — replaced text "MY GRIND" / "MG" with real logo assets across the entire app. `assets/apple-touch-icon.png` + `assets/favicon.png` regenerated from current `mark.png` (was old red/black design); inline base64 for splash + header re-encoded too. Commits `3b8f48c`, `a9978b9`, `6a5c5db`.
- ✅ **All customer-facing email → support@mygrindapp.com** — 59 replacements across signup/softball/terms/privacy + CREATOR_EMAILS access list (admin login flips to support@). Backup admins (papamike@, michael@youngsbaseball.com) preserved. Commit `b92d7dc`.
- ✅ **P0 security audit complete** — CREATOR_PIN backdoor (was hardcoded "YBG2026") removed from softball.html; CORS allowlist locks `/api/send-invite` to mygrindapp.com origins only; Firestore rules verified auth-required + uid-scoped; `SMS_DRY_RUN=false` confirmed missing in Vercel Production (intentional for pre-TFV). Commit `e74e05d`.
- ✅ **Phase 2 — Sport-aware copy** in softball.html. Title/meta/OG/body all swap on `?sport=` via head-script template system (`data-mg-text` attribute + `window.mgSportName`). Sport-aware ⚾↔🥎 emoji swap on softball.html + onboarding.html. Commit `d8cf6c5`, `c7f117c`, `7f98d7a`.
- ✅ **Screen 8 stale-player-cards bug fixed** — 5th render path with the same trim bug as Screens 6/7 (selectPlayerCount, buildScreen7, buildPhoneConfirmList, getFallbackPlayerNames). Now slices `state.players` to `playerCount` at render time. Commit `4f6aa32`.
- ✅ **YBG → MyGrind newsletter merge** decision locked. Issue #1 of "The Grind Weekly" drafted in Notion (`345819955e6f817181bdd396d9fb1c41`) ready to send 2026-05-05 7am PT — announces the brand merge at top, includes full MyGrind app intro + pricing + MYGRIND6 promo, scout/recruiting training topic, 60-yard dash drill, new permanent "For the Parents" section, YBG travel team CTA, Pocket Radar gear pick. After send: YBG Mailchimp audience absorbed into MyGrind audience tagged `ybg-legacy`, YBG audience archived.

### 2026-05-03
- ✅ **Phase 5 Step 1 — Skip-trial Stripe redirect wired** in `signup.html`. `onSkipTrialClicked()` redirects to one of 4 live Payment Links (Single/Family × Annual/Monthly) based on `state.preferredPlan` + `state.playerCount`, with `?prefilled_email=` from the parent's typed email. Steps 2-4 (webhook + dashboard pay flow) deferred pending baseball-side fix. (uncommitted in working tree)
- ✅ **Baseball Side Phase 1 — palette swap** in `softball.html`. Sport-detection script in `<head>` reads `?sport=` URL param → `mg_sport` localStorage → default baseball, sets `data-sport` on `<html>` synchronously before paint, updates theme-color meta. `:root` CSS variables (`--gold`, `--accent-rgb`) with `[data-sport="softball"]` override. Splash circle + diamond pattern bg now swap with sport. (uncommitted)
- ✅ **Baseball Side Phase 3 — per-player sport handoff** across `signup.html`, `api/send-invite.js`, and `onboarding.html`. Screen 6 in signup gets a per-player sport tile picker (Baseball / Softball / Both) shown only when `familySport === 'both'`; otherwise auto-derives from family sport. `buildSmsForPlayer(player)` builds invite URL with `&sport=`, matching `api/send-invite.js`. `onboarding.html` mirrors the Phase 1 detection script + `:root` palette tokens; 33 `#C9A84C` → `var(--gold)`, 11 `rgba(201,168,76,…)` → `rgba(var(--accent-rgb), …)`. `parseUrlParams()` accepts `?sport=baseball|softball|both`; `firstFlowScreen()` skips S1 sport-picker when sport is pre-filled. `setSport()` (when kid does pick) propagates to `data-sport` + localStorage + theme-color. (uncommitted)
- ✅ **YBG branding removed** from visible UI in `softball.html`. 8 `>YBG</div>` instances → `>MG</div>` (splash, header, team logos). Team-create placeholders updated to generic examples (`Lions Travel 14U`, `ABC`, etc.). Default team name `YBG TRAVEL` → `YOUR TEAM`. Fallback abbreviation `'YBG'` → `'MG'`. Internal references intentionally kept: `ybg_*` localStorage keys (would break testers), `CREATOR_PIN = 'YBG2026'` (admin access), `YBG_QOTD` variable, console prefixes, cache name. (uncommitted)
- ✅ **State trim bug fixes** in `signup.html`. `selectPlayerCount()` now trims `state.players` when count drops. Render-time slice in `buildScreen7()`, `buildPhoneConfirmList()`, `getFallbackPlayerNames()` so stale slots from prior sessions don't leak into invite previews (visible bug: confirm modal showed Lucas + Sofia when only 1 player picked). (uncommitted)
- ✅ **`?reset=1` URL handler** in `signup.html` for clean test runs — wipes `mg_signup_state`, `mg_sport`, `ybg_creator` and lands at Screen 1. Strips the param from URL bar after wipe. (uncommitted)
- ✅ **SEO baseline** — H1 hardcoded, canonicals (www), noindex on funnel pages, robots.txt, sitemap.xml. Commits `c864e00` + `e238322`.
- ✅ **Phase 5 preflight 🟢 GO** — verified Stripe account, all 6 prices live, webhook endpoint configured, all 3 Stripe env vars set in Vercel Production. Two non-blocking flags surfaced: 2 duplicate Family products to archive in Stripe dashboard, 3 legacy Stripe URLs in `softball.html` (lines 3662-3664) need separate audit.
- ✅ **Locked Decision #16** — "Both" sport means a single multi-sport athlete (one kid who plays baseball AND softball), NOT a family with mixed-sport kids. Refines Decision #7.
- ✅ **Pre-launch infrastructure** (morning marathon): `/morning-sync`, `/eod-sync`, `/save-prompt`, `/publish-prompts`, `/phase5-preflight`, `/twilio-tfv-prep` skills built. 73 read-only MCP tools pre-approved. Scheduled tasks armed (5:10am + 9:08pm PT). Drive prompt library shipped. Canva launch carousel V2 (10 slides) on Coach's Canva account. MyGrind Family product + 4 Payment Links + `MYGRIND6` promo (250 cap, expires 2026-09-01) wired in Stripe.

### 2026-05-02
- ✅ **Family pricing tier shipped** — added a $149.99/yr · $14.99/mo flat household plan covering 2-3 players, alongside the existing Single tier ($99/yr · $9.99/mo per player). Screen 5 pricing cards render dynamically via `renderPricingCards()` based on `state.playerCount` (1 → Single, 2-3 → Family) with a "You Save $X" line below each Family card. Anti-abuse defenses: per-plan phone uniqueness check (no two players share the same real number; fallback exempted), slot-lock fires on first SMS-send (Screen 7 entry → `state.playersLockedAt` ISO timestamp), navigating back to Screen 6 after lock shows a read-only view with a gold banner pointing users to `coach@mygrindapp.com` for swaps. Settings modal updated to explain the swap-via-email policy. Stripe URLs deferred to Phase 5.
- ✅ **Phase 6 — Real Share + Settings modals on signup dashboard** — replaced the two `alert('coming in Phase 6')` placeholders on Screen 8 with proper modals reusing the existing `.phone-confirm-overlay` shell. Share modal has a copy-link button (Clipboard API + execCommand fallback), a Web Share API "Share…" button shown only on supporting browsers, and a pre-written share caption. Settings modal shows read-only account summary (name, email, phone, plan, players) populated from `state.parent` + `state.preferredPlan` + `state.playerCount`, plus a `mailto:coach@mygrindapp.com` link for change requests until Phase 5 wires backend editing.
- ✅ **Phase 3d — Twilio Lookup pre-check** — new `lib/lookup.js` module + integration in `api/send-invite.js`. Calls Twilio Lookup v2 with `line_type_intelligence` between E.164 normalization and rate-limit checks. Rejects invalid numbers, landlines, and VoIP with friendly user-facing messages before burning rate-limit budget or paid SMS sends. Fail-open on Lookup outage. `SKIP_LOOKUP=true` env override for dev. Cost ~$0.005/lookup, bounded by upstream rate limits.
- ✅ **Pre-launch waitlist landing page** at `mygrindapp.com` — brand-styled `index.html` with Mailchimp form (audience `73280b4c02e9bc56c7e633892`, tag `2216797`). Replaced the old redirect shell that bounced visitors to signup.html.
- ✅ **Mailchimp JSONP integration** — replaced optimistic iframe submit with real `subscribe/post-json` call so users see actual success/error messages instead of silent failures.
- ✅ **Mobile sizing fixes for landing** — compact email input (34px tall), narrower form card on portrait, landscape media query, vertical centering with `safe center`, iOS Safari rotation-zoom fix via `maximum-scale=1`.
- ✅ **Disabled Mailchimp reCAPTCHA on the form** so JSONP path doesn't bounce real users into a challenge that can't render.
- ✅ **Critical CSS corruption fix in `onboarding.html`** — `.screen`, `.screen.on`, `.screen-body`, `.prog-wrap` rules had nested braces and orphan property remnants from a prior find/replace incident. Restored intended layout.
- ✅ **`saveState()` data-wipe killed** in `softball.html` — the catch block was silently writing `entries: []` on quota errors. Now leaves previous save intact and surfaces a one-time alert pointing to backup.
- ✅ **GameChanger Option 1 disabled** — the screenshot reader called Anthropic API directly from the browser (CORS-blocked, no key). Replaced with "Coming Soon" notice pointing to Option 2 (manual entry).
- ✅ **Backup & Restore feature re-shipped** in `softball.html` Settings tab — JSON download/upload of all `ybg_*` keys (auth/session keys denylisted). Includes "last backup: X days ago" display.
- ✅ **Backup nudge re-shipped** — non-blocking gold banner appears on app load when user has 3+ entries AND no backup in 7+ days. Dismissable for the session.
- ✅ **Brand system doc** at `docs/BRAND_SYSTEM.md` documenting design tokens for future MyGrind web surfaces.
- ✅ **`media/` folder** added for launch graphics + social assets.
- ✅ **STATUS.md + ROADMAP.md rewritten** to reflect current architecture (signup/onboarding/softball/landing) instead of the old single-file index.html state.

### Earlier (rolled into this list when I clean up)
- ✅ Tab reorder (daily-use features up front)
- ✅ Instructor Session log in Daily Journal
- ✅ Daily affirmation banner (60 affirmations rotating)
- ✅ Instructor as entry type (focused form when selected)
- ✅ Universal "NO GRADES · NO GAME" banner (sport-neutral)
- ✅ Pink palette for softball mode
- ✅ 20 softball-specific quotes
- ✅ Custom academic classes
- ✅ Cloud backup (manual Save to Cloud)
- ✅ Sport selector on trial signup
