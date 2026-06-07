# Push Notifications — Daily Reminder Build Plan

**Goal:** a true daily reminder that reaches a player even when the app is closed
("Log today's MyGrind / keep your streak alive"), free at scale, COPPA-clean.

**Decision (2026-06-06):** push, not SMS, for the *daily* reminder. SMS stays for
high-value moments (invite, trial-ending, payment, occasional win-back). Daily
texting minors is a cost + COPPA + channel-burn problem; push avoids all three.

Status today: shipped the no-backend stand-ins — in-app Dashboard nudge
(`renderDailyNudge`) + downloadable `.ics` (`downloadDailyReminderICS`). This doc
is the plan for the real push system.

---

## ⚠️ Prerequisite: migrate the service worker to a real file

Push **cannot** work with the current setup. Today the SW is built inline in
`softball.html` (~line 1456):

```js
const blob = new Blob([swCode], { type: 'application/javascript' });
const swUrl = URL.createObjectURL(blob);
navigator.serviceWorker.register(swUrl);   // blob URL — no push support
```

A blob-URL service worker has no stable same-origin scope, so the Push API will
not deliver to it. **Step 0 is to move the SW into a real file `/sw.js`** served
from the site root and register it with scope `/`. Keep the existing
install/activate/fetch caching logic; just relocate it and bump the cache version.
This is the riskiest single step (a broken SW can break offline/load), so test it
in isolation first, on a phone, before adding anything push-related.

---

## Architecture (all pieces)

```
softball.html (client)                 Vercel (serverless)            Push service
─────────────────────                  ───────────────────            ────────────
[Settings toggle: Daily reminder]
   → Notification.requestPermission()
   → reg.pushManager.subscribe(VAPID_PUBLIC)
   → POST /api/push-subscribe ───────► api/push-subscribe.js
        {subscription, tz, hour,            └─ store in Firestore
         consent}                              pushSubscriptions/{uid}

/sw.js  ◄───────────────────────────── api/cron/daily-reminder.js ──► web-push
   push  → showNotification()               (Vercel cron, hourly)        (VAPID)
   notificationclick → open app               └─ query subs where
                                                  local hour == now,
                                                  send; delete 404/410
```

## Components / files

1. **`/sw.js`** (new file) — relocate current SW caching logic; add:
   - `self.addEventListener('push', e => { e.waitUntil(self.registration.showNotification(title, opts)); })`
   - `self.addEventListener('notificationclick', e => { e.notification.close(); e.waitUntil(clients.openWindow('/softball.html#journal')); })`
2. **`softball.html`** — change registration to `navigator.serviceWorker.register('/sw.js', {scope:'/'})`. Add the opt-in flow:
   - "Daily reminder" toggle in Settings (and wire the nudge's "Remind me daily" to it).
   - On enable: request permission → `pushManager.subscribe({ userVisibleOnly:true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC) })` → POST to `/api/push-subscribe` with the subscription, `Intl.DateTimeFormat().resolvedOptions().timeZone`, preferred hour, and (for minors) parent-consent flag.
   - On disable: `subscription.unsubscribe()` + DELETE `/api/push-subscribe`.
3. **`api/push-subscribe.js`** (new) — POST stores / DELETE removes the subscription in Firestore, keyed by the signed-in user (reuse the existing Firebase auth / magic-link identity). Store `{ subscription, tz, hour, enabled, consentBy, updatedAt }`.
4. **`api/cron/daily-reminder.js`** (new) — mirror `api/cron/weekly-digest`. Runs hourly; loads enabled subs whose local time (tz + hour) equals the current hour; sends via `web-push.sendNotification(sub, payload, {vapidDetails})`. On `404/410` delete the sub. Guard with a `PUSH_DRY_RUN` env (send only to the creator first), mirroring `SMS_DRY_RUN` in `send-invite.js`.
5. **`vercel.json`** — add a cron entry: `{ "path": "/api/cron/daily-reminder", "schedule": "0 * * * *" }` (hourly; the function filters to the right local hour).
6. **`package.json`** — add `web-push`.

## Decisions to make (with recommendations)

| Decision | Options | Recommendation |
|---|---|---|
| Subscription store | Firestore vs Redis | **Firestore** — firebase-admin already a dep, durable + queryable, ties to existing auth/managed-minors |
| v1 targeting | send to all enabled at their hour vs only-if-not-logged-today | **v1: send to all enabled.** "Logged today" lives in localStorage (server can't see it). v2: add a tiny client heartbeat so the cron can skip active users |
| Reminder time | fixed 6 PM vs per-user picker | **Default 6 PM, store per-user hour** so a picker is a 1-line add later |
| Minor consent | reuse managed-minors parent consent | **Yes** — gate the toggle behind parent acknowledgement for under-13 profiles; store `consentBy` |

## Env vars (Vercel)
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (from `npx web-push generate-vapid-keys`)
- `VAPID_SUBJECT` (e.g., `mailto:support@mygrindapp.com`)
- `PUSH_DRY_RUN` (defaults ON; only the creator's device gets real pushes until flipped)

## iOS caveat (reach)
Web push on iOS works **only for an installed PWA on iOS 16.4+**, and the permission
prompt only appears after install. So push reach = players who installed + allowed
notifications. This is exactly why the prominent **install card** matters — it grows
the push-eligible base. Android + desktop Chrome/Edge work without install.

## COPPA / privacy
- Push needs **no phone number** (big win vs SMS).
- For under-13 players, gate behind **parent consent** (reuse managed-minors flow); record who consented.
- Add push to the privacy policy data list. Store minimal data; honor disable = delete subscription.

## Rollout (phased, test each on a phone)
- **Phase A — SW migration.** `/sw.js` real file, push + notificationclick handlers, cache bump. Verify app loads + works offline. No push yet.
- **Phase B — opt-in + store.** VAPID keys, Settings toggle, subscribe, `api/push-subscribe`. Test: subscribe creator's own phone, store row appears.
- **Phase C — send.** `api/cron/daily-reminder` + `web-push`, hourly cron, with `PUSH_DRY_RUN` → creator only. Confirm a real push arrives with the app closed. Then flip dry-run off.
- **Phase D (optional) — smart + time picker.** Client heartbeat to skip players who already logged today; per-user reminder time.

## Effort & caution
Roughly **1.5–2 focused build sessions.** This is backend + a service-worker change —
exactly the kind of work the `CLAUDE.md` "no real infra while rushed / walk every
screen / structural sanity check" rules are about. Build it deliberately, keep
`PUSH_DRY_RUN` on until verified on a real device, and bump the SW cache version
carefully so the migration doesn't strand offline users.
