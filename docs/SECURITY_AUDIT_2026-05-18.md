# MyGrind Security Audit — 2026-05-18

**Scope:** Pre-launch defensive review of the MyGrind app at `mygrindapp.com`. Covers backend serverless functions (api/), shared libs (lib/), and client-side HTML.

**TL;DR:** No critical vulnerabilities found. The Stripe + Twilio + Redis stack is solid. Three HIGH-priority items below worth addressing before opening waitlist to the public. The biggest gap is one I CAN'T verify from the local repo: Firebase Firestore security rules (check Firebase Console).

> ⚠️ **GitHub repo is PUBLIC.** Confirmed via `gh repo view`. Every commit at `github.com/youngsbaseball/mybaseballgrind` is publicly visible. This isn't itself a vulnerability (lots of SaaS apps run from public repos), but it means:
> - This audit doc was intentionally NOT committed. Keep it local-only.
> - Never commit `.env` files, real env-var values, Firebase rules, Stripe keys, Twilio tokens, or this audit.
> - The Firebase API key in softball.html is public-by-design (Firebase web SDK). That's expected.
> - All real security depends on (a) Vercel env vars (not in repo), (b) Firestore rules (in Firebase Console, see S0), (c) Stripe webhook secret (Vercel env var), (d) CRON_SECRET (Vercel env var).

---

## 🚨 CHECK MANUALLY (I cannot verify locally)

### S0 — Firebase Firestore security rules

Firebase API key is in client-side `softball.html` (this is expected — Firebase web SDK requires it). **The actual security is enforced by Firestore RULES.**

If the rules are still set to test-mode (`allow read, write: if true;`) the entire Firestore database is publicly readable AND writable by anyone with the API key (which is everyone, since it's in the HTML).

**Action:**
1. Open Firebase Console → `my-grind-b8486` → Firestore Database → Rules tab
2. Verify rules are NOT `allow read, write: if true`
3. Recommended starter rules:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
    match /users/{uid}/entries/{entryId} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```
4. The actual signup flow doesn't yet call `fbSignUp` (cloud sync wiring incomplete per today's session) — so Firestore is currently DORMANT in practice. But anyone reading the source could write garbage data to ANY uid path if rules are open. Worth locking down before launch.

**Severity:** HIGH if rules are open. Negligible if rules are locked down.

---

## 🔴 HIGH (fix before launching)

### H1 — `/api/feedback-list` exposes coach feedback by phone or email
**File:** `api/feedback-list.js:38-50`
**Issue:** Anyone who knows or guesses a player's phone number (10 digits) can GET this endpoint and receive their entire coach-feedback history — coach name, focus area, situation text, the player's question note, and the coach's response. The file's own comment admits this:
> "anyone who knows the player's phone or the parent's email can list their feedback. That is acceptable for V1..."
**Impact:** Privacy leak of youth player mental-game data. Phone numbers aren't secrets — they're texted to coaches, shared on team rosters, posted to social. Combined with the 10-digit search space, an attacker could enumerate players relatively quickly. Especially sensitive because these are kids 11-18.
**Fix:** Require a request token or HMAC. Even passing a hash of `(playerPhone + secret)` as a second URL param would make enumeration infeasible. Or scope V2 to authenticated reads only.

### H2 — `/api/feedback-request` has NO rate limiting
**File:** `api/feedback-request.js:71-117`
**Issue:** No `checkIpLimit` or `checkPhoneLimit` calls. An attacker can POST coach feedback requests at unlimited rate. Each one creates a Redis record (90-day TTL) and, when Twilio TFV approves, sends a real SMS to whatever coach phone the attacker chooses.
**Impact:** (a) Redis storage bloat, (b) SMS spam to coaches once Twilio TFV approves — real Twilio cost (~$0.008/send). Could be weaponized to send harassing SMS to specific coach numbers.
**Fix:** Add the same `checkIpLimit` / `recordSend` flow from `send-invite.js`. Maybe also `checkPhoneLimit` against the COACH phone so a single coach can't be flooded.

### H3 — PII logged in cleartext to Vercel logs
**Files:** `api/digest-unsubscribe.js:120`, `api/stripe-webhook.js` (multiple), `api/send-invite.js:119`, others
**Issue:** Emails and (in some cases) phone numbers are written to `console.log`/`console.warn` in cleartext. These end up in Vercel function logs, visible to anyone with access to the Vercel project (currently just Coach, but if a teammate is added later, they get full PII access).
**Impact:** CCPA-relevant. California residents have data-minimization rights; logs holding their emails indefinitely is a soft violation.
**Fix:** Either:
- Hash emails before logging: `crypto.createHash('sha256').update(email).digest('hex').slice(0,12)` — keeps logs debuggable, removes PII
- Or partial-redact: `j****@example.com`
- Or set a Vercel log retention policy (Pro plan only)

---

## 🟡 MEDIUM (limit blast radius)

### M1 — `/api/feedback-respond` race condition on `already_responded` check
**File:** `lib/feedback-store.js:121-147`
**Issue:** Between `r.get('feedback:req:'+id)` (line 126) and `r.set(...)` (line 141), there's a TOCTOU window. Two concurrent POSTs to `/api/feedback-respond` with valid token can BOTH pass the `record.status === 'responded'` check, and the last write wins.
**Impact:** Token-holder can race themselves to overwrite a response. Requires knowing the token (not brute-forceable at 128 bits), so this is exploitable only by the legitimate coach OR someone who intercepted the magic link. Worst case: data loss on coach's reply.
**Fix:** Wrap the read-modify-write in a Redis Lua script for atomicity, OR use `SET ... NX` on a separate `feedback:resp:<id>` key as a lock.

### M2 — `/api/get-subscription` allows email enumeration
**File:** `api/get-subscription.js:32-54`
**Issue:** No auth. Pass any email, get back `isPaid: true/false`. Lets an attacker check which emails are paying customers.
**Impact:** Phishing target enumeration. An attacker could try a list of leaked emails and pick out the paying ones for "your card failed, click to update" phishing.
**Fix:** V2 (full account auth) closes this. For V1, consider returning the same response (`{ ok: true, isPaid: null }`) for unknown emails to defeat enumeration.

### M3 — `/api/feedback-respond` has NO rate limiting (DoS only)
**File:** `api/feedback-respond.js:67-109`
**Issue:** No rate limit. Token entropy is fine (128 bits — not brute-forceable), but the endpoint itself can be hammered with bad-token requests, consuming Redis reads + serverless invocation cost.
**Impact:** DoS economic. Not a real takeover risk.
**Fix:** Add IP rate limit.

---

## 🟢 LOW / INFO

### L1 — `?unlock=1` URL parameter grants creator UI access
**File:** memory says this exists. Confirmed in `softball.html:6196-6210` (`isCreator()`)
**Issue:** Self-grants creator access by setting `localStorage.ybg_creator = 'true'`. Anyone reading the source could do this.
**Impact:** **UI-only.** Server-side paid features still check the real `acc.paid` via `/api/get-subscription`. Doesn't grant real feature access — just unlocks the local journal view (which is local-first anyway, already accessible). Acceptable as a dev backdoor for Coach himself.

### L2 — `localStorage.setItem('ybg_creator', 'true')` is bypassable
**Files:** `softball.html:6649, 7302, 7350`
**Issue:** Same as L1. Client-side access control is bypassable via DevTools.
**Impact:** Same as L1 — UI-only, not real feature access. Standard local-first app pattern.

### L3 — `softball.html:14209` uses `document.write` for journal export
**File:** `softball.html:14209`
**Issue:** `document.write` is generally discouraged. Verified: all user-controlled data interpolated into the export HTML uses `escapeHTMLExport()`. No XSS risk.
**Impact:** None. ✓ Safe.

### L4 — CORS allowlist doesn't prevent non-browser requests
**Files:** All `api/` endpoints
**Issue:** CORS is a browser-enforced same-origin policy. `curl`, scripts, and server-to-server requests bypass it entirely.
**Impact:** CORS allowlist is decorative. Real protection is rate limiting + signature verification + token validation. CORS just stops casual cross-origin browser attacks.
**Note:** This is intended design, not a bug. Flagging so you don't rely on CORS as auth.

### L5 — `vercel.json` has no explicit security headers
**File:** `vercel.json` (only has cron config)
**Issue:** No `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options`, `Referrer-Policy`, or `Permissions-Policy` headers configured.
**Impact:** Defense-in-depth gap. Vercel sets some defaults but not all. CSP would mitigate XSS if any slipped through.
**Fix (post-launch polish):** Add a `headers` block to `vercel.json`. Sample:
```json
"headers": [{
  "source": "/(.*)",
  "headers": [
    { "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains; preload" },
    { "key": "X-Content-Type-Options", "value": "nosniff" },
    { "key": "X-Frame-Options", "value": "SAMEORIGIN" },
    { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
    { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=()" }
  ]
}]
```
A full CSP needs careful tuning since the app inlines a lot of CSS/JS. Defer to post-launch.

### L6 — Hashing IP/phone with unsalted SHA-256
**File:** `lib/rate-limit.js:70-73`
**Issue:** Fixed-domain inputs (10-digit phones) are reversible via rainbow table if Redis is breached.
**Impact:** If Redis is breached, you have much bigger problems than rate-limit key reversal.
**Note:** Acceptable.

---

## ✅ CLEAN (verified safe)

- **Stripe webhook signature verification** (`api/stripe-webhook.js:81`) — uses `stripe.webhooks.constructEvent(rawBody, sig, webhookSecret)` correctly. Raw-body parsing disabled in `config.bodyParser: false`. ✓
- **Stripe webhook idempotency** (`lib/subscription-store.js:73-75`) — `existing.lastEventId === rawEventId` check prevents replay. ✓
- **Stripe cancellation email** (today's commit `520668b`) — fails gracefully, doesn't fail webhook on send error. ✓
- **Twilio SMS rate limiting** (`api/send-invite.js`) — two-tier (IP + phone), recorded BEFORE Twilio send to protect even on Twilio failure. SHA-256 hashed PII. Atomic Redis INCR. ✓
- **Twilio Lookup pre-check** (`lib/lookup.js` via `send-invite.js:130`) — rejects landlines/VoIP before burning budget. Fail-open on Lookup outage. ✓
- **Feedback magic link token** (`lib/feedback-store.js:42`) — 32 hex chars / 128 bits entropy, generated via `crypto.randomBytes`. Not brute-forceable. ✓
- **HMAC unsubscribe token** (`api/digest-unsubscribe.js:42-48`) — HMAC-SHA256 using CRON_SECRET, 8-byte tag. Tamper-proof. ✓
- **Mailchimp signup endpoint exposure** (`index.html:823`) — public-by-design (Mailchimp's standard JSONP form post). Audience ID + form ID are not secrets. ✓
- **Firebase API key in client** — public-by-design (Firebase web SDK). Real security depends on Firestore rules (see S0). ✓
- **Stripe price/product IDs not in client HTML** — checked, zero occurrences. All gating goes through the server `/api/get-subscription`. ✓
- **No hardcoded server secrets in client HTML/JS** — checked all HTML files. ✓
- **`escapeHTMLExport()` properly used in journal export** (`softball.html:14156-14178`) — every user-controlled value is escaped before being interpolated into HTML. ✓
- **`encodeURIComponent` used for inline onclick handlers with email data** (`softball.html:16680`) — quotes escaped to `%27`, no attribute-context XSS. ✓
- **`m.note` / `m.name` innerHTML at softball.html:15450-15451** — `m` comes from the hardcoded `months[]` training calendar array, NOT user input. Safe. ✓
- **CRON_SECRET gating on weekly digest** (`api/cron/weekly-digest.js`) — requires `Authorization: Bearer ${CRON_SECRET}`. ✓
- **No `eval()` or `new Function()` anywhere in the repo.** ✓
- **No CORS wildcards** — every endpoint uses explicit allowlist of `mygrindapp.com` origins. ✓

---

## 📋 Suggested action order

1. **First (today/tomorrow):** S0 — Verify Firebase Firestore rules in console. If they're open, lock them. This is the only true critical item.
2. **Before public launch:** H1 (feedback-list token), H2 (feedback-request rate limit), H3 (hash PII in logs). All three are small code changes, ~30 min each.
3. **Post-launch polish:** M1 (race condition Lua), M2 (subscription enumeration mitigation), L5 (Vercel headers).
4. **Future / V2:** M2 properly via full auth.

---

## 📁 Files reviewed

- api/stripe-webhook.js, send-invite.js, feedback-request.js, feedback-respond.js, feedback-get.js, feedback-list.js, get-subscription.js, digest-unsubscribe.js
- lib/rate-limit.js, feedback-store.js, subscription-store.js, lookup.js, email-digest.js (skimmed)
- api/cron/weekly-digest.js (skimmed)
- softball.html (XSS surfaces, innerHTML usage, access control)
- signup.html, onboarding.html, index.html, privacy.html, terms.html, coach-reply.html, legacy-app.html (XSS / secret leakage)
- vercel.json (headers)
- package.json (deps versions — all current)

**Not reviewed (out of scope):**
- Firebase Firestore rules (in Firebase Console, not local repo — see S0)
- Vercel environment variable contents (you confirm these in Vercel dashboard)
- Stripe webhook destination configuration (configured in Stripe dashboard)
- Stripe live-mode API key scopes (Stripe dashboard)
- Mailchimp audience permissions (Mailchimp dashboard)
- Twilio account permissions (Twilio Console)
