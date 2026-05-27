# MyGrind — COPPA Compliance Audit

*Conducted: 2026-05-27 by Claude · Audit type: Spot check · Scope: COPPA only*

## Executive Summary

**Status: Significantly exposed.** MyGrind's written policies (privacy.html §12, terms.html §2.2) say the service is not for under-13 users, but the production code paths actively serve under-13 children (softball.html `pl-age` input accepts ages 5–25, onboarding.html offers a "Younger than 13 (with parent help)" age tile, and softball.html line 19507 has an explicit `isKid = age > 0 && age < 13` branch that personalizes copy for under-13 players). Public marketing (index.html JSON-LD schema + FAQ) explicitly advertises to "ages 9-22", which is FTC-cognizable "actual knowledge" that under-13 users are in the audience. The disclaimers in privacy.html and terms.html will not survive FTC scrutiny once the regulator pulls the page source.

**Top recommendation:** Pick ONE posture and align the code, the policy, and the marketing with it. Either (a) genuinely exclude under-13 by removing the "Younger than 13" tile, raising the `min` on `pl-age` to 13, and reframing public copy from "ages 9-22" to "ages 13-22" — OR (b) build a real COPPA program (parental-consent gate, parent-access portal, deletion workflow, a children's-privacy section in the policy). Option (a) is days of work. Option (b) is weeks-plus. Option (a) is strongly recommended unless under-13 is a material part of the business.

---

## Findings by Section

### 1. Under-13 data collection

**The app collects the following from any user, including under-13:**

- **signup.html, parent path** — collects parent: first name, last name, email, phone. Collects ABOUT each player (entered by the parent on Screen 6, lines 2706–2768): player first name, relationship (Son/Daughter/Other), per-player sport, player phone number, or a fallback flag indicating no separate phone. **No player age is captured at signup.**

- **signup.html, self path** — same parent fields (treated as the player's own contact info). No age input. The "I'm 18 or older" copy on the audience picker (line 2136) is decorative — selecting the "Just me" tile is a button click with zero age verification (`selectAudience('self')` at line 3380 just sets state.signupFor = 'self'; no gate).

- **onboarding.html** — once a player tile loads this page, lines 491–495 ask "How old are you?" with 5 options. Line 495 explicitly offers `pick(this,'age','Younger')` labeled "Younger than 13 (with parent help)". Selecting this option flows through the full 11-step onboarding (position, level, team name, goals, struggles, coach-feedback expectations, training days). Profile is saved to `localStorage.mg_player_profile` (lines 1331–1357).

- **softball.html (the journal app)** — the source of the most sensitive data:
  - Line 4418: `<input type="number" id="pl-age" placeholder="e.g. 15" min="5" max="25" oninput="saveProfile()">` — **accepts ages 5 through 25.**
  - saveProfile() at line 13098 collects: name, position, age, grade, school, bats/throws, GPA, season, 60-yard time, velocity, height/weight bio, "why I grind" essay (200 chars).
  - Player generates: journal entries (text reflection, mindset emoji, "what worked," "tomorrow's focus"), workout logs, game stats (auto-calculated AVG/OBP/SLG/ERA), goals, streaks, coach-feedback exchanges.
  - All of this saves to `localStorage` AND to Firebase Firestore via `fbSaveProfile()` / `fbSaveEntry()` (lines 18836–18854), keyed by Firebase Auth uid.

- **api/cron/weekly-digest.js** — pulls every parent email with feedback activity in the past 7 days and sends a digest. This is parent-only, not player-targeted, so it is not an under-13 issue by itself.

**Players whose age is under 13 and have been through onboarding therefore have, at minimum, in Firestore:** screen name (first name or nickname), age, school/team name, sport, journal text entries, goals, stats. Plus parent's full name, email, and phone via the linked account. This is squarely "personal information" under 16 CFR § 312.2.

### 2. Age verification mechanism

There is no functional age gate anywhere in the signup flow.

- **signup.html Screen 0** — the audience picker asks "Who's this for?" with two tap cards: "I'm a parent" and "Just me — I'm 18 or older." The "18 or older" line is plain copy in the card body (line 2136). No checkbox, no DOB field, no logic. Underneath an `under18-callout` div (line 2141) advises under-18s to use the parent path — also plain copy, no enforcement.
- **signup.html parent path Screen 6** — does not capture player's age at all. A parent provides only first name, relationship, sport, and phone number.
- **onboarding.html Screen 2** — the player IS asked their age, and one of the 5 explicit options is "Younger than 13 (with parent help)" (line 495). This option does not branch into a parental-consent verification path; it just stores `d.age = 'Younger'` and continues to position selection.
- **softball.html Profile tab** — accepts any age 5 to 25 (line 4418).

**Loopholes a 10-year-old can use today:**
1. Tap "Just me" on signup.html, enter their own name/email/phone, complete signup. No age is ever asked through signup.html. They arrive on softball.html, set `pl-age = 10`, and start logging.
2. Tap "Younger than 13 (with parent help)" on onboarding.html. The flow does not pause for parental consent; it just continues.
3. A parent signs up, never enters the child's age in signup.html. On onboarding.html or softball.html the child enters their real age (under 13). The age then drives the under-13 journal-prompt swap at softball.html line 19518 — the code path explicitly recognizes them as under 13 and tailors the experience.

### 3. Parental consent flow

The parent-path signup is **not** verifiable parental consent under the FTC rule.

What the parent does today:
1. Taps "I'm a parent" (signup.html Screen 0).
2. Enters their own name, email, phone (Screen 2).
3. Picks family sport and player count (Screen 3).
4. Picks goals (Screen 4) and a price plan (Screen 5).
5. Enters their child's first name, relationship, and phone (Screen 6). Crucially, **no consent statement specific to collection of the child's personal information**.
6. On the phone-confirmation modal (signup.html line 3057–3058) the parent taps "Yes, send" which authorizes sending the **invite SMS**. The wording is SMS-specific ("I authorize MyGrind … to send a one-time invite SMS … I have the authority to provide these numbers"). There is no language acknowledging that the child will then create a profile, generate journal entries, and have age/school/stats stored in Firestore, nor a notice of what data will be collected, used, or shared.
7. The invite link lands on onboarding.html where the child enters their age and other data with no further parental involvement.

Verifiable parental consent (16 CFR § 312.5) requires that the operator make reasonable efforts to ensure that the person consenting is in fact the child's parent. None of the FTC-accepted methods are present:
- No credit-card verification at the consent step (card is collected post-trial, not as a consent signal).
- No government ID, no video conference, no signed form, no "email-plus" follow-up.
- No knowledge-based authentication.

Coach Young already knows the FTC standard requires more than self-attestation; the current parent-path flow does not satisfy any of the listed methods.

### 4. Privacy policy

privacy.html ([source](../privacy.html)) is well-structured for the audience the policy describes (ages 13–17 and 18+), but the policy describes a service that the code does not actually deliver.

What the policy says about children:

- §2 "Who Can Use MyGrind" (line 89–96): "MyGrind is not intended for and does not knowingly collect information from children under 13 years of age. If we discover that we have collected information from a child under 13, we will promptly delete it."
- §12 "Children's Privacy (Under 13)" (line 215–216): same disclaimer in standalone form.

What the policy is missing if the service is actually directed at or knowingly serves under-13:
- No section dedicated to types of personal information collected from children.
- No section on how that information is used and shared.
- No COPPA-specific notice of the parent's right to review the specific information collected from their child, request deletion, refuse further collection, or refuse to consent to disclosures to third parties.
- No direct operator contact line for COPPA inquiries beyond the general `support@mygrindapp.com` (acceptable, but should be specifically labeled in a children's section).
- No description of FTC-acceptable parental consent methods.

What the policy says about parents (§6 line 167–176) is sound on its face — parent has the right to review, update, delete, refuse further collection, and export — but the mechanism is "email support@mygrindapp.com" with a 30-day response window. There is no in-product interface, and no documented internal SOP for honoring the request. This is acceptable for a small operator, but a real workflow needs to be tested.

### 5. Parental access / deletion

There is no in-product parental access to the child's collected data.

- signup.html Screen 8 (the parent dashboard) renders a player card per player with **all data sections greyed out and locked** (signup.html line 4881–4929: streak, games logged, practices logged, coach feedback, season stats, goals, journal entries — every section is a 🔒 placeholder). The dashboard cannot show the journal text or stats today. Line 4929 explicitly states "text stays private."
- A parent who wants to see what their child logged must either (a) borrow the child's device and unlock with the child's PIN, or (b) sign in as the child (passwordless email + 6-digit code) using the child's email on signin.html. Neither is a documented parental access workflow.
- Deletion is "email support@mygrindapp.com" per privacy.html §6. No self-serve deletion exists in-product. Firestore documents at `users/<uid>/profile` and `users/<uid>/entries/*` would need to be manually purged by an admin.

For COPPA the parent must be able to (a) review the specific information collected from the child, (b) refuse further collection, (c) ask for deletion. The current mechanism — email support@mygrindapp.com — is technically a permitted channel, but it is undocumented as a runbook, untested at scale, and the response SLA in the policy (30 days) is at the outer edge of what is reasonable.

### 6. Data minimization

There is no formal data-retention policy in the repo. privacy.html §9 ("Data Retention") says: "We retain account and player information for as long as the account is active. If you delete your account, we will delete or anonymize your information within 30 days, except where we are required to retain it for legal, tax, or fraud-prevention purposes."

That is acceptable contract language but is not minimization. Specific gaps:

- Under-13 users get the same treatment as adult users — all profile, journal, stats, goals retained indefinitely while the account is active.
- No automatic purge of inactive child accounts (e.g., delete or anonymize a profile after 12 months of inactivity).
- No retention floor for under-13 journal text — once collected, it lives in Firestore until support is emailed.
- Firestore writes are uncapped: every journal entry creates a new doc at `users/<uid>/entries/<id>`. No cap on entry count, no aging-out.

The policy clause "for as long as the account is active" is broad enough to cover under-13 accounts that are 10 years old. COPPA expects retention only "as long as reasonably necessary to fulfill the purpose for which the information was collected" (16 CFR § 312.10).

### 7. Marketing to minors

Email marketing exposure to under-13 contacts:

- signup.html line 5186 (`mailchimpSyncSignup()`) auto-subscribes only the **parent.email** to the MyGrind Weekly Mailchimp audience. In the parent path this is the parent's email; in the self path it is the user's own email and there is no age gate, so a 10-year-old who signed up via "Just me" lands directly on the marketing list.
- index.html waitlist form (line 939, the `EMAIL` input) accepts any visitor email — no age gate. A 10-year-old browsing the site can join the newsletter.
- api/cron/weekly-digest.js targets parent emails surfaced from the feedback store. This is parent-side, not a direct minor exposure.

SMS exposure:

- privacy.html §10 and signup.html line 2784 state "We don't market to players, ever." The Twilio path is currently DRY_RUN per the project memory (TFV review pending) so no production SMS to player numbers fires at all today. When TFV unblocks, the only player-bound SMS is the one-time invite (parent-initiated, parent-consented in the phone-confirmation modal). Player numbers are stored but never used for marketing.

The SMS posture is fine. The Mailchimp + landing-page newsletter pipeline is the gap: any minor email entered there ends up on a marketing list.

### 8. Third-party data flows

Vendors that touch user data today (per privacy.html §5.1 and the codebase):

| Vendor | What it processes | Disclosed in privacy.html | DPA / COPPA concern |
|---|---|---|---|
| Firebase (Auth + Firestore + Analytics) | All user profile + journal data, including under-13 if entered | Not named in privacy.html §5.1 (says only "Hosting and infrastructure providers") | Firebase has a DPA, but children's data requires extra contracting per Google Cloud's [Children's Online Privacy Protection Act addendum](https://cloud.google.com/terms/identity/coppa). Not confirmed signed. **REQUIRES COACH INPUT.** |
| Stripe | Parent payment + name + billing address | Yes, by name | OK — Stripe does not see child data |
| Resend | Parent email transactional sends | Not named in §5.1 (the privacy policy still names Mailchimp only; Resend is the actual transactional sender per `api/auth/request-code.js`) | Adult-only contact path; low risk |
| Mailchimp | Parent newsletter list | Yes, by name | Adult-only on parent path; on self path a self-signed-up minor lands here with no age gate |
| Twilio | Player phone for one-time invite SMS + coach feedback SMS (currently DRY_RUN) | Mentioned for SMS retention in §10 but not in §5.1 vendor list | Minor's phone number is the personal identifier transmitted. Twilio is processor only; no COPPA-specific addendum apparent. **REQUIRES COACH INPUT** on whether a Twilio DPA covers minors. |
| Vercel (hosting + Analytics) | IP, browsing telemetry | Mentioned for cookieless analytics; not named in §5.1 vendor list | Cookieless makes the analytics piece OK. Hosting role is covered by general DPA. |
| Redis (Upstash, per `api/cron/weekly-digest.js`) | Parent emails + feedback metadata | Not named at all | Indirect; adult parent contact only |

Two specific privacy-policy gaps:

1. Firebase is the system-of-record for under-13 journal data and is not named in §5.1.
2. Twilio is the SMS processor for the player invite + coach feedback flow and is not named in §5.1.

### 9. Geographic scope

The service is operated by My Grind Sports LLC, a California limited liability company, hosted in the United States (Vercel US edge) with Firestore (US multi-region) and Stripe (US). COPPA applies to any operator of a website or online service directed to children in the United States or that has actual knowledge that it collects personal information from a child. Both branches are triggered:

- "Directed to children" — the index.html JSON-LD schema (line 102, 161, 185) advertises to "ages 9-22" and "Baseball and softball players, ages 9-22, and their parents/coaches." That is on its face directed at children under 13.
- "Actual knowledge" — softball.html line 19507's `isKid = age > 0 && age < 13` branch and onboarding.html line 495's "Younger than 13" tile both establish that MyGrind knows under-13 users are present.

**CCPA / CPRA also applies** (operator is a CA LLC). CCPA has separate children's-data provisions ([Cal. Civ. Code § 1798.120(c)](https://oag.ca.gov/privacy/ccpa)): selling/sharing personal information of a child under 13 requires opt-in from the parent; for 13–16 the minor themselves opts in. MyGrind already says "we do not sell or share" (privacy.html §7) so the CCPA opt-in obligation is moot, but the CCPA Right to Know / Delete / Correct still apply to all CA-resident customers, including child users, and currently route through `support@mygrindapp.com` only.

The forthcoming California Age-Appropriate Design Code Act (AADC) places further duties on services likely to be accessed by under-18s; it has been subject to litigation (NetChoice v. Bonta) but Coach should track it. **REQUIRES COACH INPUT** if a deeper review of AADC is desired separately.

---

## Prioritized Gaps (P0 → P3)

### P0 — Marketing copy contradicts policy

- **Gap:** index.html (lines 102, 161, 185) markets the service to "ages 9-22" while privacy.html §12 says "not intended for children under 13" and terms.html §2.2 says "Players under 13 are not permitted to use the Service." A regulator reading these together will conclude the operator knew the audience included under-13s and the policy disclaimer is pretextual.
- **Risk:** FTC penalty exposure up to $51,744 per violation (current 2026 inflation-adjusted cap). A single regulator complaint about marketing to under-13s while disclaiming under-13 collection is a textbook bait-and-switch.
- **Fix:** Decide the posture first. If under-13 is excluded, change every "ages 9-22" reference to "ages 13-22" in `/Users/baseballmike/Desktop/MyGrind Business/mybaseballgrind/index.html` lines 102, 161, 185. If under-13 is included, rewrite privacy.html §2 and §12 and terms.html §2.2 to match (and accept the full COPPA program burden).
- **Estimated effort:** 15 minutes for option (a) marketing changes; weeks-plus for option (b) full COPPA program.

### P0 — Onboarding offers an explicit "Younger than 13" tile

- **Gap:** onboarding.html line 495 (`<button class="opt" onclick="pick(this,'age','Younger')">⭐ &nbsp;Younger than 13 (with parent help)</button>`) is the clearest "actual knowledge" footprint in the codebase. A child can select it and complete onboarding with no parental verification.
- **Risk:** Same FTC exposure as above. This single line of HTML is the easiest piece of evidence a regulator would cite.
- **Fix:** Remove this option from onboarding.html lines 491–495. The age options should be 13-14, 15-16, 17-18, and College. Under-13 users are routed to a "Please ask your parent or guardian to set up your account on the parent path" screen.
- **Estimated effort:** 30 minutes (remove the button, add a small explainer block, decide the redirect target).

### P0 — softball.html accepts ages 5–25

- **Gap:** softball.html line 4418 `<input type="number" id="pl-age" ... min="5" max="25">` accepts ages from 5 upward. Saved to localStorage and to Firestore (line 13098 `saveProfile` + line 18838 `fbSaveProfile`).
- **Risk:** Once a 10-year-old enters age=10 and starts logging, MyGrind has a Firestore document with a child's personal information collected without verifiable parental consent.
- **Fix:** Raise `min` on `pl-age` to 13 (or whatever lower bound the new posture sets). Add a validation message: "MyGrind is for players 13 and older. If your athlete is younger, please contact support@mygrindapp.com." Also remove the `isKid = age > 0 && age < 13` branch at softball.html line 19507 because the code path itself is "actual knowledge."
- **Estimated effort:** 20 minutes for the input + validation; another 30 minutes to remove the age-aware journal prompt branch and revert prompts to the 13+ defaults.

### P1 — No real consent in the parent path

- **Gap:** The phone-confirmation modal at signup.html line 3057–3058 is the only consent surface and it consents to SMS only, not to collection of the child's profile, journal, age, school, or stats.
- **Risk:** Even if MyGrind raises the age floor to 13, regulators may argue the 13-17 cohort still warrants meaningful parental notice. CCPA also requires clear notice at or before collection.
- **Fix:** Add a consent screen (or expand Screen 6 in signup.html) explicitly enumerating what data the player will provide (age, school, journal entries, stats, photos if added), how it's stored (Firestore in the US), and who can see it (the parent on the dashboard once features unlock; nobody else). Parent taps a checkbox acknowledging this. Persist `consentedAt` ISO timestamp + a copy of the consent text version to Firestore.
- **Estimated effort:** 2-3 hours including copy review and the timestamp/versioning store.

### P1 — Privacy policy needs vendor accuracy and a children's-specific section

- **Gap 1:** privacy.html §5.1 names only Stripe, Mailchimp, and "hosting and infrastructure providers." Firebase (Auth + Firestore + Analytics), Twilio, Resend, and Vercel Analytics are all unnamed.
- **Gap 2:** If MyGrind is going to keep serving 13-17 in any form, privacy.html should have a clearly labeled "Information We Collect About Players Aged 13–17" section that addresses notice, parental rights, deletion mechanics, and operator contact specifically.
- **Risk:** Inaccurate disclosure of vendors is a CCPA Right to Know problem. A missing children's section is a COPPA notice problem even at 13+.
- **Fix:** Edit `/Users/baseballmike/Desktop/MyGrind Business/mybaseballgrind/privacy.html` §5.1 to add Firebase (with link to https://firebase.google.com/support/privacy), Twilio (https://www.twilio.com/legal/privacy), Resend (https://resend.com/legal/privacy-policy), Vercel (https://vercel.com/legal/privacy-policy), and Upstash if Redis is keeping any user-identifiable data. Add a new §6.5 "Players Aged 13–17" with the notice + parental rights flow.
- **Estimated effort:** 1 hour.

### P2 — No documented parental access / deletion workflow

- **Gap:** The dashboard does not surface child data; the only access path is email-to-support. There is no runbook for how Coach handles a parental-access or deletion request.
- **Risk:** Operationally low until the first request comes in. Reputationally high if a parent doesn't get a response in 30 days. CCPA gives 45 days.
- **Fix:** Write a short runbook in `docs/RUNBOOK-PARENTAL-REQUESTS.md` (or add a section to an existing ops doc) covering: how to look up a user by email in Firebase Auth, how to export their `users/<uid>` doc + entries collection, how to delete both Auth and Firestore data, and how to log the request with an HMAC-style hash for audit.
- **Estimated effort:** 1-2 hours including a dry run.

### P2 — Self-path has no age verification

- **Gap:** signup.html Screen 0 lets a user tap "Just me — I'm 18 or older" with no validation. The card text is decorative.
- **Risk:** A 12-year-old can claim adult status. The "they lied" defense is weak under COPPA because the operator's defense is reasonable efforts, not the user's representation alone.
- **Fix:** Add a date-of-birth modal that fires when the user taps "Just me." If DOB indicates under 18, route to the parent path. If DOB indicates 13-17 on a self-path attempt, hard-stop with copy directing parent signup. Store the DOB (or just age + flag) so the gate isn't bypassed by tapping back.
- **Estimated effort:** 2 hours including the modal styling and the bypass guard.

### P2 — Newsletter signup on index.html has no age gate

- **Gap:** index.html line 939 lets any visitor submit an email to the Mailchimp list, including under-13 visitors.
- **Risk:** Lower than the in-app journal data risk but still under COPPA — an email address is personal information.
- **Fix:** Add an "I am 18 or older, or I am a parent/guardian providing my own email" checkbox above the submit button. Required to submit. (FTC accepts this as a basic gate for newsletter signups when the service is not directed primarily at children. If posture (a) is adopted and MyGrind is no longer marketed to ages 9-22, this checkbox + the "ages 13-22" rewording covers it.)
- **Estimated effort:** 20 minutes.

### P3 — Firestore security rules not in repo

- **Gap:** Firestore rules live in the Firebase console and are not version-controlled in the repo. Without seeing them, I can't verify that `users/<uid>` is locked down per-user and that there is no path for one user to read another user's data.
- **Risk:** A misconfigured rule could expose every child's journal entries to anyone with a valid Firebase Auth token. This is a data-security finding, not a COPPA-specific finding, but COPPA §312.8 requires reasonable security.
- **Fix:** Export the current rules from Firebase Console → Firestore Database → Rules tab. Commit them to `firestore.rules` in the repo. Set up `firebase deploy --only firestore:rules` so they version with the code.
- **Estimated effort:** 30 minutes for the export and commit. **REQUIRES COACH INPUT** to read the current rules.

### P3 — No retention policy specific to minors

- **Gap:** privacy.html §9 retains data "for as long as the account is active." No max-age, no inactivity purge, no minor-specific cap.
- **Risk:** COPPA §312.10 expects retention "only as long as reasonably necessary." A 17-year-old whose account becomes inactive in 2030 has Firestore docs sitting there into the late 2030s by default.
- **Fix:** Add a clause: "We will delete or anonymize player account data after 24 months of inactivity (no journal entries or sign-ins). We will send a 30-day warning email before deletion." Implement a scheduled job (Vercel cron) that flags accounts inactive 24+ months and either deletes them or notifies the parent.
- **Estimated effort:** 1 hour for the policy clause; 2-3 hours for the deletion cron.

---

## Non-Gaps

These items are either already compliant or out of scope:

- **SMS opt-in language for the player-invite SMS** — signup.html line 3057–3058 contains a properly worded SMS-specific consent paragraph with HELP, STOP, frequency disclosure, and a Privacy Policy link. The text appropriately limits its scope to the SMS itself.
- **Stripe payment data handling** — Stripe handles its own PCI scope. Parent's card is never stored by MyGrind. No COPPA implication.
- **CCPA opt-out for sale/sharing** — privacy.html §7.4 ("We do not sell or share personal information for cross-context behavioral advertising") is correct and removes the §1798.120 children-specific consent burden.
- **Vercel Analytics** — privacy.html §11 correctly says cookieless analytics is used. This is accurate per the code (`<script defer src="/_vercel/insights/script.js">`). No COPPA cookie issue.
- **Parent dashboard does not expose child journal text** — signup.html line 4929 explicitly keeps journal text private. This is actually a feature, not a bug, for COPPA purposes (less data flowing between users). The flip side is that the parent cannot review the child's full journal text from the dashboard — for COPPA they need access via the support email flow, which works for now but should be made more explicit.
- **HTTPS, password storage, Stripe PCI** — all called out in privacy.html §8 and consistent with the code. Reasonable security per §312.8.

---

## Recommendations Beyond Compliance

These are best-practice items that go beyond the minimum COPPA bar but would make MyGrind harder to challenge and easier for parents to trust:

1. **Versioned privacy policy.** Store a `privacy_version` flag in Firestore on each user account stamping the policy version they accepted. Materially update privacy → bump version → on next sign-in, surface a "We updated our Privacy Policy. Read the changes." modal. This is cheap CCPA / GDPR hygiene and a posture signal to regulators.

2. **Email-plus consent for the parent path.** Even if you do not formally need verifiable parental consent at 13+, sending a separate "MyGrind: you just set up an account for <child first name>. Reply YES to confirm" email after parent signup adds a meaningful audit trail. Costs are roughly $0 via existing Resend.

3. **Player-side privacy notice.** softball.html could surface a one-time onboarding card: "MyGrind keeps your journal private. Only you can see it. Your parent can ask us to delete your account anytime." Builds trust with teen users and reinforces the policy.

4. **Quarterly self-audit.** Schedule a recurring Notion task for Coach to re-run an audit like this one every 90 days. The fastest way to fall out of compliance is to ship code without thinking about COPPA on every PR.

5. **Drop "ages 9-22" from public copy permanently** and refer to MyGrind as "for serious players from middle school through college." It's softer, hits the same emotional note, and avoids the specific-number trap.

---

## Next Steps for Coach

In priority order:

1. **TODAY: pick the posture.** Are under-13s in the audience or not? If not (recommended), proceed with steps 2–5. If yes, this audit underestimates the work — engage a privacy counsel before continuing.

2. **TODAY (15 min): edit index.html.** Change every "ages 9-22" to "ages 13-22" or to a softer non-numeric phrase. Lines 102, 161, 185.

3. **THIS WEEK (1 hour total): edit onboarding.html and softball.html.**
   - onboarding.html: remove line 495 "Younger than 13" tile; add a soft redirect block for under-13s.
   - softball.html line 4418: change `min="5"` to `min="13"`.
   - softball.html lines 19501–19538: remove the `isKid = age > 0 && age < 13` branch and keep only the 13+ default prompts.

4. **THIS WEEK (1 hour): edit privacy.html.**
   - §5.1: add Firebase, Twilio, Resend, Vercel, Upstash to the vendor list.
   - §9: add the 24-month inactivity purge clause.
   - §12: rewrite to reflect that the service is now genuinely directed at 13+ users only, with a clearer process for parents to report under-13 access.

5. **THIS WEEK (30 min): export Firestore security rules** from Firebase Console and commit them to `firestore.rules` so they are reviewable.

6. **THIS MONTH: add a parental-access runbook** (`docs/RUNBOOK-PARENTAL-REQUESTS.md`) and dry-run one full request-and-delete cycle on a test account.

7. **THIS MONTH: add the age-gate modal to the "Just me" self-path** in signup.html so it cannot be silently bypassed by a 12-year-old.

8. **POST-COMPLIANCE (next quarter): redo this audit** to confirm the changes hold up.

---

**REQUIRES COACH INPUT:**

1. Are Firestore security rules currently configured so that `users/<uid>` documents are readable only by that user's authenticated session? (Export them and we can verify.)
2. Has Coach signed Google Cloud's COPPA addendum for Firebase, or relied only on the general Firebase DPA? (See https://cloud.google.com/terms/identity/coppa.)
3. Does the Twilio account have a COPPA-relevant addendum on file, or just the standard DPA?
4. Is there an existing "delete user" admin script for Firebase Auth + Firestore that I missed in the repo? (I only found `api/admin/founder-count.js` and `api/admin/signin-link.js`.)
5. Posture decision: stay 13+ only (recommended), or commit to a full COPPA program for under-13 (weeks of work + ongoing audit overhead)?
