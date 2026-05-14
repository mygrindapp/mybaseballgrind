# DNS Records — mygrindapp.com

**Snapshot date:** 2026-05-12
**Registrar:** Namecheap
**Authoritative DNS:** `dns1.namecheaphosting.com` / `dns2.namecheaphosting.com`
**Where DNS is edited:** **cPanel Zone Editor** (NOT Namecheap Advanced DNS — that tab is empty for this domain). Path: Namecheap dashboard → Hosting List → cPanel → Zone Editor.
**Cloudflare migration:** pending (see DNS_FIX.md history + memory note)

This file is the single source of truth for what records exist on `mygrindapp.com`. Update it every time a record is added, changed, or removed. It exists so that the eventual Cloudflare cutover doesn't lose anything.

---

## Current records (captured 2026-05-12 via `dig`)

| Type | Name | Value | TTL | Purpose |
|---|---|---|---|---|
| A | `@` (apex) | `216.198.79.1` | — | Vercel edge — routes mygrindapp.com to the `mybaseballgrind` Vercel project |
| CNAME | `www` | `mygrindapp.com.` | — | Alias www → apex (Vercel handles both) |
| MX | `@` | `5 mx1-hosting.jellyfish.systems.` | — | Namecheap email hosting (supports `support@mygrindapp.com`, possibly `coach@`) |
| MX | `@` | `10 mx2-hosting.jellyfish.systems.` | — | Namecheap email backup |
| MX | `@` | `20 mx3-hosting.jellyfish.systems.` | — | Namecheap email backup |
| TXT (SPF) | `@` | `v=spf1 +a +mx +ip4:192.64.117.253 +ip4:192.64.118.103 include:spf.web-hosting.com ~all` | — | SPF for Namecheap email |
| TXT (DMARC) | `_dmarc` | `v=DMARC1; p=none;` | — | DMARC monitoring only (no reject) |

**Notes:**
- No AAAA (IPv6) record. Fine — Vercel serves over v4.
- No Resend DKIM yet (parent digest emails still send from `onboarding@resend.dev`).
- No Mailchimp DKIM yet (this doc gets updated when added — see below).
- Google site-verification TXT (`google826fc67b2dde2efa.html`) is served as a file on Vercel, not via DNS TXT.

---

## Verifying coach@mygrindapp.com exists

**Before** running Mailchimp domain authentication, confirm `coach@mygrindapp.com` is a real mailbox (Mailchimp will send a verification email there).

Steps:
1. Log into Namecheap → Email Hosting → mygrindapp.com → Mailboxes
2. If `coach@mygrindapp.com` does NOT exist → create it (free under Namecheap Stellar plan)
3. Set forwarding to `youngsbaseball@gmail.com` so messages don't get lost
4. Test by sending an email to `coach@mygrindapp.com` from a third-party account and confirming it lands in Gmail

---

## Records to ADD for Mailchimp (MyGrind Weekly newsletter)

Mailchimp generates account-specific values, so fill in the `<placeholders>` after running the Mailchimp UI step (Audience → Settings → Verified domains → Authenticate).

| Type | Name | Value | Purpose |
|---|---|---|---|
| CNAME | `k1._domainkey.mygrindapp.com` | `dkim.mcsv.net` | Mailchimp DKIM (used by ALL Mailchimp accounts — value is fixed) |
| CNAME | `k2._domainkey.mygrindapp.com` | `dkim2.mcsv.net` | Mailchimp DKIM backup |
| TXT | `@` | `v=spf1 +a +mx +ip4:192.64.117.253 +ip4:192.64.118.103 include:spf.web-hosting.com include:servers.mcsv.net ~all` | **REPLACE existing SPF** — adds `include:servers.mcsv.net` (Mailchimp's sending servers). Do NOT add a second SPF record. |

**Critical:** Do not create a second SPF TXT record. Edit the existing one and add `include:servers.mcsv.net` before `~all`.

After adding records:
- Wait 15 min – 24 hrs for propagation
- Mailchimp → Audience → Settings → Verified domains → click "Authenticate domain" → it auto-checks

---

## Records to ADD for Resend (parent digest emails — DEFERRED)

Pending DNS migration to Cloudflare. Once migrated:

| Type | Name | Value | Purpose |
|---|---|---|---|
| TXT | `resend._domainkey` | (Resend-generated long DKIM value) | DKIM for `noreply@mygrindapp.com` |
| MX | `send` | `feedback-smtp.us-east-1.amazonses.com` (priority 10) | Bounce/complaint feedback to Resend |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` | SPF for Resend's sending subdomain |

These won't break Namecheap email because they're on the `send.mygrindapp.com` subdomain, not the apex.

---

## DMARC upgrade (recommended after Mailchimp + Resend are live)

Current: `v=DMARC1; p=none;` — monitoring only.

After both DKIM authentications pass for ~7 days clean, upgrade to:

```
v=DMARC1; p=quarantine; pct=10; rua=mailto:dmarc@mygrindapp.com; sp=quarantine;
```

Then slowly raise `pct=10` → `pct=50` → `pct=100`, then move `p=quarantine` → `p=reject`. This protects the MyGrind brand from spoofing once we're sending real volume.

---

## Cloudflare migration checklist (when ready)

Use this file to recreate every record exactly. Never change nameservers (`dns1/dns2.namecheaphosting.com` → Cloudflare's `xxx.ns.cloudflare.com`) without:

1. Capturing the latest snapshot of this file
2. Lowering all TTLs to 300 (5 min) at Namecheap 48 hrs ahead of cutover
3. Pre-creating every record in Cloudflare before flipping nameservers
4. Verifying with `dig @1.1.1.1` after the flip

---

## Change log

| Date | Change | By |
|---|---|---|
| 2026-05-12 | Initial snapshot created | Coach Young session |
| 2026-05-12 | DNS cutover from Namecheap shared-host email (jellyfish.systems) to Namecheap Private Email. Deleted 3× jellyfish MX records. Added 2× privateemail.com MX (both priority 10). Replaced SPF with `v=spf1 include:spf.privateemail.com ~all`. Added Private Email DKIM TXT at `default._domainkey`. Also added Mailchimp DKIM CNAME at `k3._domainkey` → `dkim3.mcsv.net`. Verified propagated via dig. | Coach Young session |
