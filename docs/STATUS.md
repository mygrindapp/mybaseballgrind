# 📊 My Grind — Current Status

*Last updated: 2026-05-16 PM. Update this file at the end of every coding session.*

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
- **Phase 3b (Twilio SDK + Live Send)** — code complete, BLOCKED on toll-free verification. Submitted 2026-05-13 (rejected: Error 30489 + 30513), resubmitted 2026-05-14 under sole-prop track (rejected again 2026-05-15: Error 30484 legal entity name mismatch + Error 30489 website not established). My Grind Sports LLC was filed 2026-05-15 specifically to fix Error 30484; LLC approval check 2026-05-20 at bizfile.sos.ca.gov. Plan: 5-20 verify CA approval and download stamped Articles, 5-21 update privacy.html + terms.html + footer to reference My Grind Sports LLC, 5-21 or 5-22 resubmit Twilio with legal entity "My Grind Sports LLC" + EIN 42-2579197 + Business Type LLC. Prioritized-review deadline 2026-05-22. Until approval, SMS stays in DRY_RUN mode and parent invite flow falls back to email or use-this-device path.
- **Phase 3c (Rate Limiting)** — COMPLETE + VERIFIED (Redis-backed, hashed IP/phone, fail-open)
- **Phase 3d (Twilio Lookup pre-check)** — COMPLETE (2026-05-02). `lib/lookup.js` runs Twilio Lookup v2 between E.164 normalization and rate-limit checks; rejects landlines, VoIP, and invalid numbers with friendly messages before any send budget is burned. Fail-open on Lookup outage.
- **Phase 4 — Player Onboarding** — `onboarding.html` shipped (per Decision #13: stripped of Stripe/Mailchimp/Firebase, just localStorage)
- **Phase 5 — Stripe wiring** — COMPLETE (2026-05-05). Step 1 (skip-trial Stripe redirect) shipped 2026-05-03. Steps 2-4 shipped 2026-05-05: webhook (`api/stripe-webhook.js`) verifies signatures and updates Redis subscription store on subscription events; Pay button on signup.html Screen 8 redirects to live Payment Links; softball.html syncs paid status from `/api/get-subscription` on every load. Stripe webhook destination "fascinating-oasis" live in Workbench listening to 5 events. Real subscriptions now flip `isPaid` automatically.
- **Phase 6 — Share + Settings buttons on signup dashboard** — COMPLETE (2026-05-02). Real modals replace the placeholder alerts. Share modal has copy-link + Web Share API + pre-written caption. Settings modal shows read-only account summary (name, email, phone, plan, players) + a support-email link for changes (self-serve editing lands when Phase 5 backend account management ships).
- **Family pricing tier** — COMPLETE (2026-05-02; price reconciled 2026-05-06 to match live Stripe link). $149.99/yr · $14.99/mo flat for 2-3 players in one household, alongside the existing Single tier ($99/yr · $9.99/mo per player). Anti-abuse stack: hard cap at 3 slots, slot-lock at first SMS-send, per-plan phone uniqueness, single-parent invite path (already in place).
- **Phase 7 — Player dashboard** — softball.html IS the live player dashboard. Walkthrough across five marathon sessions (2026-05-09 / 5-10 / 5-11 AM / 5-11 PM / 5-12): Daily Journal, My Stats, Profile, Goals, and Dashboard are now COMPLETE. Today's session (5-12, 21 commits, SW v145 → v167) shipped: Off Day flow built end-to-end (😴 dropdown label with "(full rest)", info banner, lock system blocking other training types when an off-day exists, hard duplicate guard in saveEntry, instant unlock on delete via renderAll wiring); Reflection redesigned with 🪞 intro card, mindset emoji picker (🔥 😌 🙏 😐 😤 😞 saved as entry.mindset), cream accent + Lora italic prompts, title no longer required; Reflection prompts opened up beyond today/tomorrow ("What's been on your mind?" / "What is this stretch teaching you?" / "What are you carrying forward?"); Off Day prompts rewritten to affirmation/recovery/family ("Today's affirmation", "How are you taking care of yourself?", "Who or what filled your cup today?"); Save Entry button feels like a button (:active press, gold pulse, haptic, universal pointerdown press-flash across every button); instant entry-list update on save (force `_entriesFilter` + renderEntries direct + last-resort fallback to 'all' filter); Dashboard reorganized for parent-awareness (Today's Plan removed as redundant, Weekly Recap + Parents Portal merged into single "Share With Family" card, Coach Comms lifted to top right under Academics, Hitting + Fielding grouped); Rest Days dashboard card (7d / month / season counters); streak emoji tiers (🧊 no streak / 🔥 active or 3+/week / 💎 streak ≥ 7); age band broadened to middle school (6th + 7th grade added to Profile, School/Team label inclusive of MS/HS/college/travel, MS-friendly goal presets including Make MS Team, JV, 60+/70+/75+ MPH pitching, Sub-8.0 / Sub-7.5 60-yard); modern font stack (SF Pro / Roboto / Inter for body, Bebas Neue + Barlow Condensed for branded display); touch accessibility (input font-size 15px → 16px to kill iOS auto-zoom, touch-action: manipulation to kill 300ms tap delay, transparent tap-highlight). Remaining walkthrough tabs: Settings + Coach Feedback inbox card on Dashboard.
- **Phase 7b V1 — Coach feedback loop** — COMPLETE (2026-05-04). End-to-end: player → SMS magic link → coach-reply.html → SMS player + parent dashboard card. Redis-backed `lib/feedback-store.js`, 4 API endpoints, 32-hex token auth, 90-day TTL. SMS via Twilio (DRY_RUN until TFV approves).
- **Phase 7b V1.5 — Parent weekly email digest** — COMPLETE in TEST MODE (2026-05-05). Vercel cron `/api/cron/weekly-digest` fires Mondays at 14:00 UTC (~7am PDT), scans Redis for active parent emails, sends warm-dark branded HTML digest via Resend. All emails redirected to youngsbaseball@gmail.com via `WEEKLY_DIGEST_TEST_EMAIL` env until `mygrindapp.com` is verified in Resend (DNS migration deferred). Sender: `onboarding@resend.dev`.
- **Adult self-signup funnel (Scope X)** — COMPLETE (2026-05-06). `signup.html` now opens with a Screen 0 audience picker ("My Athlete" / "Myself"). Self path branches via `state.signupFor='self'`: relabeled copy on Screens 1-4 (`applySelfLabels(n)`), playerCount question hidden on Screen 3, Screen 6 auto-fills + skips to Screen 7. URL handoff `?self=1` to `onboarding.html` triggers self-aware PIN screen + welcome + end-of-flow copy. Scope Y polish (Screen 8 dashboard + S14 deeper kid-coded copy) deferred.
- **Multi-sport platform Phase 1** — COMPLETE (2026-05-06). `softball.html` refactored into a sport-aware shell themed per `data-sport`. Central `SPORTS` config object (baseball/softball/both) with `getSportConfig()` helper. 165 hardcoded pink color refs → `var(--gold)` family. 16 hardcoded 🥎 → ⚾ HTML defaults (DOM walker swaps per sport). Bidirectional `applyBallEmoji()`. New `window.setActiveSport(s)` global re-themes live. Multi-sport toggle UI in dashboard header for `family=both` users (live ⚾↔🥎 swap, no reload). Recipe doc `docs/ADD_A_SPORT.md` makes adding football/volleyball/etc. a ~15-minute job. Phase 2 (sport-specific drill content) + Phase 3 (per-sport landing pages) deferred.
- **Promo code system** — COMPLETE (2026-05-06). Collapsible "Have a promo code?" gold-pilled button on Screen 5 of `signup.html`. Persists to `state.promoCode`. New `buildCheckoutUrl()` helper appends `prefilled_promo_code=` + `prefilled_email=` to Stripe Payment Link URL. Both checkout entry points (skip-trial + dashboard pay-early) use it.
- **Founder Launch Offer** — COMPLETE end-to-end (2026-05-13 stack, Mailchimp welcome live 2026-05-14). Full stack: Stripe coupon renamed "MyGrind Founders - 6 Month Free" with new promotion code `FOUNDERMYGRIND` (0/100, 6 months free); old `MYGRIND6` deactivated. `signup.html` PROMO_INFO swap + new `?promo=<code>` URL param handler in DOMContentLoaded so launch-day email links one-click into Screen 5 with code pre-applied and trial copy already flipped. `index.html` reframed as founder offer — new `.founder-note` block between hero and form with personal letter from Coach pitching FOUNDERMYGRIND, CTA swap ("Notify Me" → "Reserve My Spot", "Be First To Know" → "Reserve Your 6 Months Free"), trust line + success message rewritten in Coach's voice (re-edited 2026-05-14 to sign as "Coach" not "Coach Young" and drop em-dashes per Decisions #34 + #35). Mailchimp tag stays `2216797` — every signup from here is a founder cohort entry by definition. Stripe enforces the 100-redemption cap; email/page do not police (Decision #32). Mailchimp welcome automation rewritten in founder voice and LIVE 2026-05-14 (subject "Your founder spot is held.", sent immediately on subscribe from `coach@mygrindapp.com`). Launch-day broadcast email drafted, ready when Coach pulls the trigger.
- **Email infrastructure for mygrindapp.com** — COMPLETE (2026-05-13). SPF/DKIM/DMARC/PTR all valid. SPF: `v=spf1 +mx +a +ip4:192.64.118.103 +include:spf.web-hosting.com +include:spf.privateemail.com ~all`. DMARC: `v=DMARC1; p=none;` (monitor mode — tighten to quarantine after 30 days clean reports). Untangled the cPanel/Private Email shadow problem: MX has been pointing to `mx1/mx2.privateemail.com` all along (not `jellyfish.systems` as old memory note claimed). cPanel `coach@` and `support@` mailboxes were dead-letter boxes — could send outbound but never received inbound. Deleted the cPanel zombies. Private Email is now the single source of truth for `@mygrindapp.com` inbound (Decision #33). `coach@mygrindapp.com` Auto-Forward → `youngsbaseball@gmail.com` configured in Private Email webmail. `support@` forwarding queued (30-second click for Coach to repeat).
- **Brand voice + sole-prop legal posture** — LOCKED (2026-05-14). Decisions #34/#35/#36 formalized: universal "Coach" voice (never personal name), no em-dashes anywhere, sole proprietorship (no LLC). Cleanup commits: `253450e` voice rule across landing + coach-reply.html; `a38a683` em-dash purge from founder note + thank-you; `d7a9700` 8 LLC claim removals across privacy.html + terms.html. Twilio TFV resubmission unblocked once site + form became consistent.
- **Phase 7 walkthrough (Profile / Journal / Off Day / Dashboard / Calendar)** — 99% COMPLETE (was 95%, advanced 2026-05-14). Profile: generic School / Team placeholder, name field reworded, height/weight Notes example rewritten, 🎒 emoji dropped from Basics & Physical, ⚾ photo placeholder replaced with dark camera SVG, onboarding-to-softball name bridge bug fixed (`mg_player_profile` → `ybg_softball_profile` on first run). Journal: all expandables default collapsed, Game entry label "Title / Opponent" → "Opponent", Off Day prompt "Who or what filled your cup" → "Who was in your corner". Dashboard: Month Focus reads as standards not checkboxes, month card pulls live from `months[]` data (no longer stuck on April), D3 Academics tile added, Share With Family coordinates with all 7 entry types, My Photobook button removed (Pro feature), 12-Month Training Calendar tile surfaced, "📋 This Week" sample card pulls current week's prescription. Calendar: checkboxes converted to gold ▸ bullet rows, "← Back to Dashboard" pill added, 6 months realigned to real periodization (May/Jun/Jul/Aug/Nov/Dec). Only Settings tab + Coach Feedback inbox card walkthrough remain. SW cache v167 → v183 across 16 bumps.
- **12-Month Training Calendar — realigned to real periodization** — COMPLETE (2026-05-14). Web-verified against current CIF Southern Section (prelims May 14, finals May 29-30, state regionals June 2-6) and NCAA D1 (regular season ends ~May 24, CWS June 12-22) schedules. Six months rewritten: May (regular season closes + CIF playoffs path), June (post-season 3-week throwing rest + week 4 strength build kickoff), July (build phase continues, no longer duplicates rest content), August (escalates the build rather than introducing it), November (heavy lifting through Thanksgiving, transition begins Week 4 FRI/SAT), December (maintenance + yoga + explicit 2-3 week winter-break throwing rest). Calendar bullets converted from checkboxes to playbook-style gold arrow rows. Dashboard "📋 This Week" card samples the current week's prescription live. All copy passes em-dash brand-rule audit.
- **SEO foundation** — COMPLETE (2026-05-07 PM). Title rewritten "MyGrind — Baseball & Softball Training Journal App" (51 chars, brand + sport keywords). Description, Open Graph, Twitter Card all wired with explicit width/height/alt/type/locale. JSON-LD `@graph` on `index.html` with 3 nodes — Organization, WebSite, SoftwareApplication (with 3 Offer prices). 1200×630 OG card at `/assets/og-card.png` (Canva-generated, brand-kit aligned, LinkedIn preview verified). Vercel Web Analytics live + collecting on all 6 public pages (cookieless, privacy.html §11 compliant). Google Search Console URL-prefix property verified via `/google826fc67b2dde2efa.html`; sitemap submitted with **Success** status. Indexation timeline: 2-7 days first crawls, 2-4 weeks branded "MyGrind app" surfaces, 4-8 weeks full maturity. Single-reference doc lives at `docs/ANALYTICS.md`.
- **SEO Entity Authority** — ~95% COMPLETE (advanced massively 2026-05-16). Schema upgrade with new Person node + bidirectional founder ↔ worksFor link shipped (commits `508f2a4`, `639d87a`). Organization sameAs now includes linkedin.com/company/mygrind. Founder bio framing locked to "35 years in baseball as a coach, trainer, dad, and mentor" (replaces "20 years coaching"). Personal LinkedIn fully rebranded to MyGrind-primary at **linkedin.com/in/coachmikeyoung** (custom slug, banner + pic + name + headline + About + Founder position + Skills + Location all aligned, Open to Work off). YBG LinkedIn Company Page DEACTIVATED (14-day soft delete ends ~2026-05-30). MyGrind LinkedIn Company Page location set Santa Clarita CA. Crunchbase profile SUBMITTED (manual review, 1-5 business day SLA, lands at crunchbase.com/organization/mygrind). First MyGrind-branded LinkedIn post live. Remaining 5%: add Crunchbase + GBP URLs to sameAs once approvals land, monitor GSC recrawl. Knowledge Graph entity disambiguation should mature 5-7 days from today. Strategy locked per Decision #39: optimize for "MyGrind" (one word) only; concede "my grind app" two-word query to Grindr permanently.

- **Pre-launch app polish marathon** — 12 commits 2026-05-16 (`0e4723a` → `770b69c`). More menu rebuilt (Training Calendar removed, Help & FAQ modal added, Send Feedback + Suggest Feature mailto buttons added, My Team + Coach Feedback hidden for August 2026 coach-side sprint). Back-to-Dashboard pills added to Team / Coach Feedback / Settings panels. Bottom nav reordered Dashboard-first (matches Strava / MyFitnessPal / Whoop / Apple Fitness+ / Hudl / Notion pattern). "Baseball Journal" → "Sports Journal" → "Players Journal" rebrand wave (sport-neutral, future-proofs new sports). "No Grades, No Baseball" → "No Grades, No Game" across 13 instances. Coach Young personal-name attributions purged from both quote arrays (Decision #34) and replaced with "The Grind". Edit Mode banner upgraded to hero block (Bebas Neue headline + gold gradient + explanatory body copy). Quote arrays doubled from ~30 to 70 entries each (10 weeks unique daily content). Em-dash sweep first pass cleared 28 high-visibility instances (421 remain in deeper surfaces, queued). Coach notes get a new "📤 Send to Coach" share button on past entries (OS share sheet, workaround for hidden Coach Feedback panel). SW cache v183 → v194 across 11 bumps. Only Lucide icon swap remains before player-side launch-ready.
- **MyGrind legal entity** — FILED 2026-05-15. My Grind Sports LLC submitted to CA Secretary of State (approval check 2026-05-20 at bizfile.sos.ca.gov). EIN 42-2579197 issued by IRS. DBA: MyGrindapp. Separates MyGrind from Young's Baseball Group (still sole prop) for compliance and liability. CA calendar deadlines: 2026-08-05 Statement of Information ($20), 2026-09-15 Franchise Tax ($800). Coach is a 70% VA-disability veteran; DVBE (CA state) + SDVOSB (federal) certifications eligible after LLC approval.
- **Email aliases on @mygrindapp.com** — LIVE 2026-05-15. Four aliases wired through Namecheap Private Email all routing into coach@'s mailbox: hello@, press@, billing@, support@. Test email from hartdistrict.org → support@mygrindapp.com landed in Gmail at 6:14am PT confirming end-to-end forwarding. Unified auto-reply ("Got your note.") drafted for Vacation Notice paste in Private Email webmail.
- **Business Plan** — 14/14 sections COMPLETE
- **39 Locked Decisions** (2 added 2026-05-15: #38 form My Grind Sports LLC in California to solve Twilio TFV legal entity verification and separate MyGrind from YBG, #39 optimize brand SEO for "MyGrind" one word only and concede "my grind app" two-word query to Grindr permanently; 4 added 2026-05-14: #34 universal "Coach" voice for MyGrind never personal name, #35 no em-dashes or AI-pattern punctuation in any MyGrind/YBG copy, #36 Young's Baseball Group is a sole proprietorship not an LLC, #37 12-month calendar is reference playbook not checklist; 3 added 2026-05-13: #31 founder-letter voice for launch messaging, #32 Stripe enforces the 100-redemption cap not the page/email, #33 Private Email is sole source of truth for @mygrindapp.com inbound; 3 added 2026-05-11: #28 Off Day is a first-class entry type distinct from Reflection, #29 every entry is tagged with the sport it was logged under, #30 streak counts every entry type including Off Day; 3 added 2026-05-10: #25 edit-PIN protection on entries >24h old, #26 solo practice is a first-class entry sub-type, #27 two-way coach messaging deferred to Phase 7b V2 / MyGrind Pro; #24 implicit from 2026-05-09 marathon — workout entry type, journal-sourced stats, fielding stats, derived game-day arm load; #23 from 2026-05-07: onboarding completion auto-grants softball.html trial access; #20-22 from 2026-05-06: multi-sport architecture, Family Annual = $149.99, self-signup is a branch in signup.html) — source of truth in Notion

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
3. 📊 My Stats (now includes Training Volume + arm-load tier card)
4. 🏆 Goals (lives on Dashboard now — old standalone tab removed earlier)
5. 📚 Academics
6. 📅 Training Calendar
7. 👥 Team
8. 👤 My Profile
9. ⚙️ Settings (now includes Backup & Restore)
- ~~📲 Share~~ — REMOVED 2026-05-08. Share modal still works for milestones; the dedicated Share tab and panel-share div were retired (panel kept hidden in DOM for future restore, More-menu entry deleted).

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
