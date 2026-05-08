# 📊 MyGrind — Analytics & Business Pulse

*Last updated: 2026-05-07. Single reference for where every business
metric lives + how to read it.*

---

## 🚀 Quick links — bookmark these

| What | Where to look | Direct URL |
|---|---|---|
| **Visitors / page views** | Vercel Analytics | https://vercel.com/youngsbaseballs-projects/mybaseballgrind/analytics |
| **Free trials** | Stripe Dashboard → Subscriptions, filter `trialing` | https://dashboard.stripe.com/subscriptions?status=trialing |
| **Paid subscribers** | Stripe Dashboard → Subscriptions, filter `active` | https://dashboard.stripe.com/subscriptions?status=active |
| **One-time payments** | Stripe Dashboard → Payments | https://dashboard.stripe.com/payments |
| **MRR / cohort / churn** | Stripe Dashboard → Sigma or Revenue Recognition | https://dashboard.stripe.com/billing |
| **Search rankings + indexation** | Google Search Console | https://search.google.com/search-console?resource_id=https%3A%2F%2Fwww.mygrindapp.com%2F |
| **OG/social preview** | OpenGraph.xyz | https://www.opengraph.xyz/url/https%3A%2F%2Fwww.mygrindapp.com |
| **Production deploys** | Vercel project | https://vercel.com/youngsbaseballs-projects/mybaseballgrind |

---

## 1. Visitors → Vercel Analytics

**What it tracks:** anonymous, cookieless page views and unique
visitors across `index.html`, `signup.html`, `softball.html`,
`onboarding.html`, `privacy.html`, `terms.html`. Privacy-first per
`privacy.html` §11 — no cookies, no PII.

**What to look at:**
- **Visitors** — unique visitors in the time window
- **Page Views** — total page loads (multi-page sessions count more)
- **Bounce Rate** — % of single-page visits. Low = good (people exploring)
- **Top Pages** — which URLs are getting the most traffic
- **Top Referrers** — who's sending traffic (Instagram, search, direct, etc.)

**Funnel hypothesis to test:** if top pages are
`index.html` ≫ `signup.html` ≫ `softball.html`, that's expected
(funnel-shape). If `signup.html` rivals `index.html`, people are
landing direct on signup (probably from `@youngsbaseball` posts) —
that's worth optimizing for.

**Cadence:** check the dashboard once a week. It's free up to 2.5k
events/month — way more than current scale needs.

---

## 2. Free Trials → Stripe Dashboard

**Two paths can create trials:**
1. **Parent signup:** signup.html → Stripe Payment Link with 14-day
   trial → Stripe creates a subscription with `status: "trialing"`.
2. **Player onboarding:** onboarding.html grants a 7-day local trial
   by writing `ybg_softball_access.trialStart` to localStorage. This
   trial is local-only and doesn't show up in Stripe — softball.html
   gates the journal on it.

**What to look at in Stripe:**
- Active trials this week (Subscriptions → filter `trialing`,
  group by Created date)
- Trial → Paid conversion rate (compare last week's trial count to
  this week's `active` upgrades)
- Trial dropoff — trials that ended without converting

**Note:** local 7-day trials (player-side) aren't tracked anywhere
right now. If we ever want to measure player engagement, we'd need
to ship a tracking event from softball.html → server. Deferred.

**Cadence:** weekly. First trial doesn't even exist yet (no users) —
this becomes meaningful after launch.

---

## 3. Paid Subscribers → Stripe Dashboard

**Tiers (all live in Stripe, prices reconciled 2026-05-06):**

| Plan | Price | Stripe Product |
|---|---|---|
| MyGrind Annual (Single) | $99 / yr | Single Annual |
| MyGrind Monthly (Single) | $9.99 / mo | Single Monthly |
| MyGrind Family Annual | $149.99 / yr (up to 3 players) | Family Annual |
| MyGrind Family Monthly | $14.99 / mo (up to 3 players) | Family Monthly |

**Promo codes active:**
- `MYGRIND6` — 6 months free, 250 redemptions, expires 2026-09-01
- `FOREVERYOUNG2026` — lifetime free, 10 redemptions, expires 2030-12-31

**What to look at:**
- Active subscriptions (broken down by plan)
- New subs this week
- Cancellations this week
- Refunds (rare — investigate each one)
- Stripe webhook health: https://dashboard.stripe.com/workbench/webhooks
  — destination `fascinating-oasis` should show no failures

**Cadence:** weekly skim. Monthly: pull MRR + cohort retention.

---

## 4. SEO + Indexation → Google Search Console

**What's verified:** `https://www.mygrindapp.com/` (URL-prefix
property, HTML file method — file at `/google826fc67b2dde2efa.html`
must stay in repo).

**Sitemap submitted:** `/sitemap.xml` — Status `Success` as of
2026-05-07. Includes homepage + privacy + terms.

**What to look at weekly (Search Console → Performance):**
- **Total clicks** — how many people clicked through from Google
- **Total impressions** — how many times we showed up in search
- **CTR** — clicks ÷ impressions. Higher = better headline + meta
- **Average position** — where we rank on average (1.0 = top spot)
- **Top queries** — what people are searching when they find us

**What to look at weekly (Search Console → Indexing → Pages):**
- **Indexed pages** — should grow from 0 → 3 (homepage, privacy,
  terms) over the first 1-2 weeks, then plateau
- **Not indexed (with reason)** — some are intentional (signup,
  softball, onboarding are `noindex`). Anything unexpected = problem.

**Indexation timeline (brand-new domain):**
- 2-7 days: first crawls, homepage shows in `site:mygrindapp.com`
- 2-4 weeks: branded "MyGrind app" search starts working
- 4-8 weeks: full indexation maturity, possible knowledge panel

**Cadence:** check `site:mygrindapp.com` in a Google search every
Sunday for the first month. Then monthly.

---

## 🗓️ Weekly review checklist (~10 min, every Sunday)

```
☐ Vercel Analytics — visitors + top pages this week
☐ Stripe — new trials, new subs, cancellations
☐ Stripe webhooks — any failures?
☐ Search Console — clicks/impressions trend, position, top queries
☐ Search Console — any indexing errors?
☐ Quick Google search: site:mygrindapp.com  (count of indexed pages)
☐ Mailchimp — list growth this week (audience 73280b4c02e9bc56c7e633892)
```

## 🗓️ Monthly review checklist (~30 min, first of the month)

```
☐ Pull MRR from Stripe → record in Notion roadmap
☐ Pull cohort retention (subs created N months ago, % still active)
☐ Trial → Paid conversion rate over the last 30 days
☐ Top 3 pages by visitors → are they the right pages?
☐ Top 5 search queries → any keyword opportunities?
☐ Refund rate — should be < 2%
☐ Update STATUS.md with monthly numbers
```

---

## 🤖 Want this automated?

Two upgrade paths if manual checks feel like too much friction:

1. **Weekly business pulse → Notion** — schedule a routine that pulls
   Stripe + Vercel data every Monday, drafts a one-page summary,
   writes to Notion under the Launch HQ. Coach reviews + edits before
   it lands. ~30 min to set up.
2. **Slack/email digest** — weekly TL;DR email with the metrics that
   matter. ~45 min to set up; needs a Resend template.

Neither is built yet. Both are queued items if Coach wants automation.

---

## 📝 Where this doc lives

This file lives at `docs/ANALYTICS.md` in the repo. Update it when:
- A new metric source comes online (e.g. PostHog, Plausible, Sentry)
- Pricing or plan structure changes
- A new dashboard URL replaces an old one
- The Stripe account migrates or changes status

Don't let it go stale — a stale analytics doc is worse than no doc.
