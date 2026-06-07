// ═══════════════════════════════════════════════════════════
// MyGrind — lib/subscription-store.js (Phase 5 Steps 2-4)
// ───────────────────────────────────────────────────────────
// Redis-backed read/write for "is this customer paid?" state,
// keyed by lowercased email. Stripe webhook events update this;
// softball.html + signup.html read it via /api/get-subscription
// to decide whether to gate paid features.
//
// Key shape:
//   sub:<email>  →  JSON { status, plan, customerId, currentPeriodEnd, updatedAt, ... }
//
// status values mirror Stripe's subscription.status enum:
//   'active'    — paying, in good standing
//   'trialing'  — in Stripe trial (we mostly use our own 14-day trial, not Stripe's)
//   'past_due'  — payment failed but still in grace
//   'canceled'  — explicitly canceled (still has access until currentPeriodEnd)
//   'unpaid'   / 'incomplete' / etc. — not granting paid access
//
// We keep the record forever once written (no TTL) so historical
// status is queryable. Stripe is the source of truth — webhooks
// keep us in sync.
// ═══════════════════════════════════════════════════════════

import Redis from 'ioredis';

let redis = null;
function getRedis() {
  if (redis) return redis;
  const url = process.env.REDIS_URL;
  if (!url) {
    console.warn('[subscription-store] REDIS_URL not set');
    return null;
  }
  redis = new Redis(url, { maxRetriesPerRequest: 2, enableReadyCheck: false });
  redis.on('error', (e) => console.error('[subscription-store] redis error:', e.message));
  return redis;
}

function normEmail(e) {
  return (e || '').trim().toLowerCase();
}

// status values that grant paid access in the app
const ACTIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);

// ─── WRITE — Stripe webhook calls this on subscription events ────
export async function upsertSubscription({
  email,
  customerId,
  subscriptionId,
  status,
  plan,            // e.g. 'single_monthly' / 'family_annual' / 'team_coach'
  currentPeriodEnd,// Unix seconds — when access ends if not renewed
  cancelAtPeriodEnd,
  hasCardOnFile,   // Option A — true once Stripe has captured a payment method
  rawEventId,      // for idempotency tracking
}) {
  const r = getRedis();
  if (!r) return { ok: false, error: 'storage_unavailable' };

  if (!email) return { ok: false, error: 'missing_email' };
  const key = 'sub:' + normEmail(email);

  // Read existing record so we can preserve fields the new event doesn't include
  let existing = {};
  try {
    const raw = await r.get(key);
    if (raw) existing = JSON.parse(raw);
  } catch (e) { /* fall through */ }

  // Idempotency — if we've already processed this exact Stripe event, skip
  if (rawEventId && existing.lastEventId === rawEventId) {
    return { ok: true, skipped: 'duplicate_event' };
  }

  const record = {
    ...existing,
    email:            normEmail(email),
    customerId:       customerId || existing.customerId,
    subscriptionId:   subscriptionId || existing.subscriptionId,
    status:           status || existing.status,
    plan:             plan || existing.plan,
    currentPeriodEnd: currentPeriodEnd || existing.currentPeriodEnd,
    cancelAtPeriodEnd:(typeof cancelAtPeriodEnd === 'boolean') ? cancelAtPeriodEnd : existing.cancelAtPeriodEnd,
    // hasCardOnFile is one-way TRUE — once Stripe has the card, it stays
    // captured even if subscription later cancels. Only an explicit refund/
    // payment-method-detach event would unset it. Preserve prior true value.
    hasCardOnFile:    (typeof hasCardOnFile === 'boolean') ? (hasCardOnFile || !!existing.hasCardOnFile) : !!existing.hasCardOnFile,
    updatedAt:        new Date().toISOString(),
    lastEventId:      rawEventId || existing.lastEventId,
  };

  try {
    await r.set(key, JSON.stringify(record));
    return { ok: true, record };
  } catch (e) {
    console.error('[subscription-store] upsert failed:', e.message);
    return { ok: false, error: 'write_failed' };
  }
}

// ─── Lifetime comp grant (FOREVERYOUNG2026) ──────────────────────
// Writes a SERVER-side paid record for a comped lifetime user so paid
// status is server-authoritative (and revocable), not just a localStorage
// flag anyone could set in DevTools (2026-06-07 audit #4). Represented as
// status:'active' + plan:'lifetime' with NO currentPeriodEnd, so the
// existing getSubscription() isPaid logic (ACTIVE_STATUSES + not-expired)
// reports isPaid:true forever with ZERO logic change. No Stripe customerId
// is set — these are comps, so the billing portal correctly returns
// no_customer (they have nothing to manage). Idempotent: preserves any
// existing fields (e.g. a real customerId if they later pay) and just
// stamps the lifetime status. The 10-cap is enforced UPSTREAM in
// founder-cohort-store.redeemFounderSlot — this only writes once a slot
// is confirmed, so it never over-grants.
export async function grantLifetime(email, source) {
  const r = getRedis();
  if (!r) return { ok: false, error: 'storage_unavailable' };

  const e = normEmail(email);
  if (!e) return { ok: false, error: 'missing_email' };
  const key = 'sub:' + e;

  let existing = {};
  try {
    const raw = await r.get(key);
    if (raw) existing = JSON.parse(raw);
  } catch (_) { /* fall through to fresh record */ }

  const record = {
    ...existing,
    email:            e,
    status:           'active',
    plan:             'lifetime',
    source:           source || existing.source || 'promo_lifetime',
    currentPeriodEnd: null,   // never expires
    cancelAtPeriodEnd:false,
    updatedAt:        new Date().toISOString(),
  };

  try {
    await r.set(key, JSON.stringify(record));
    return { ok: true, record };
  } catch (err) {
    console.error('[subscription-store] grantLifetime failed:', err.message);
    return { ok: false, error: 'write_failed' };
  }
}

// ─── READ — softball.html + signup.html dashboards call via API ──
export async function getSubscription(email) {
  const r = getRedis();
  if (!r) return { ok: false, error: 'storage_unavailable' };
  const key = 'sub:' + normEmail(email);
  if (!email) return { ok: true, record: null, isPaid: false };

  try {
    const raw = await r.get(key);
    if (!raw) return { ok: true, record: null, isPaid: false };
    const record = JSON.parse(raw);

    // Check expiration: if currentPeriodEnd has passed and status isn't active,
    // treat as not paid even if the stored status says otherwise.
    const now = Math.floor(Date.now() / 1000);
    const expired = record.currentPeriodEnd && record.currentPeriodEnd < now;
    const isPaid = ACTIVE_STATUSES.has(record.status) && !expired;

    return { ok: true, record, isPaid };
  } catch (e) {
    console.error('[subscription-store] get failed:', e.message);
    return { ok: false, error: 'read_failed' };
  }
}
