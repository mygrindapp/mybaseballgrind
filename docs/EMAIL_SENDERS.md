# 📧 MyGrind Email Senders — Canonical Reference

*Last updated: 2026-05-31. Single source of truth for every FROM address the app
sends from, plus the admin/creator allowlists. Update this file whenever a sender
or allowlist changes so the brand never drifts back toward `youngsbaseball`.*

---

## Outbound senders (what customers receive)

| Purpose | FROM address | Where it's set | Notes |
|---|---|---|---|
| Transactional onboarding (post-payment) | `MyGrind <coach@mygrindapp.com>` | `RESEND_FROM` env in Vercel (Production) | `api/stripe-webhook.js` falls back to `MyGrind <onboarding@resend.dev>` if the env var is unset — **keep `RESEND_FROM` set** or branded mail breaks. |
| Weekly parent digest (cron) | `MyGrind <coach@mygrindapp.com>` | `RESEND_FROM` env in Vercel (Production) | `api/cron/weekly-digest.js` + `lib/email-digest.js`. Same fallback caveat. |
| Magic-link / auth (legacy backstop) | `noreply@my-grind-b8486.firebaseapp.com` | Firebase Console → Auth → Templates | Google default, unbranded. Customizable to a `@mygrindapp.com` sender. Low priority — primary sign-in is now code-based. |

**Verified send domain:** `mygrindapp.com` (Resend — DKIM + SPF landed 2026-05-26).
Any `@mygrindapp.com` FROM is unlocked.

### Other branded addresses in use
- `support@mygrindapp.com` — primary support / reply-to (most-referenced address in app copy)
- `coach@mygrindapp.com` — founder voice / transactional FROM
- `hello@mygrindapp.com`, `notifications@mygrindapp.com` — secondary

---

## Admin / creator allowlists (who gets full in-app access)

Canonical list lives in `softball.html` → `CREATOR_EMAILS`:

```
coach@mygrindapp.com        ← MyGrind brand primary
support@mygrindapp.com      ← MyGrind brand primary
papamike@youngsbaseball.com ← legacy, kept for back-compat admin access
michael@youngsbaseball.com  ← legacy, kept for back-compat admin access
youngsbaseball@gmail.com    ← Coach's personal, kept for back-compat admin access
```

⚠️ The legacy `youngsbaseball.*` entries are **intentionally retained** so Coach
can't get locked out. Do not remove them. Any new admin should be a
`@mygrindapp.com` address.

> Note: a second inline copy of this list exists in the `?trial=1` QR auto-start
> guard (search `isCreatorEmail` in `softball.html`). It was reconciled to the
> canonical 5 on 2026-05-31. If you add an admin, update **both** spots.

---

## Master login (operator identity) — future cleanup

`youngsbaseball@gmail.com` is still the root login for GitHub (personal),
Vercel, Stripe, Firebase, and Mailchimp. You can't rename a Google account;
the eventual industry-standard move is a Google Workspace mailbox
(`coach@mygrindapp.com`) as the operator identity. Tracked as a non-urgent
brand-consistency item, not a code change.

---

## Deliberately NOT changed (these are correct as-is)

- **Instagram `@youngsbaseball`** — real-audience launch funnel by design
  (`@mygrindapp` has bot followers). Referenced in `index.html` /
  `foundermygrind.html` JSON-LD `sameAs`.
- **Mailchimp `youngsbaseball.us8.list-manage.com`** — bound to the Mailchimp
  account; only changes via account migration. Leave it.
- **`mg-config.js` legacy scrubbers** — two `youngsbaseball.github.io` match
  strings that rewrite stale cached URLs to the production domain. They must
  keep matching the OLD url to do their job. Do not "modernize" them.
