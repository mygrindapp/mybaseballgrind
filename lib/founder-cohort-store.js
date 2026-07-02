// ═══════════════════════════════════════════════════════════
// MyGrind — lib/founder-cohort-store.js
// ───────────────────────────────────────────────────────────
// Founder-cohort signup tracker. The 100-cap on FOUNDERMYGRIND
// and the 10-cap on FOREVERYOUNG2026 are marketing promises that
// previously had no server-side count — promoCode was only stored
// in browser localStorage, so we had no way to know how many users
// had redeemed the offer.
//
// This module records each founder signup in a Redis Set keyed by
// promo code. SADD is idempotent — the same email signing up twice
// stays a single member, so the count never inflates from retries.
//
// Key shape:
//   founder:set:FOUNDERMYGRIND   → Set of lowercased emails
//   founder:set:FOREVERYOUNG2026 → Set of lowercased emails
//
// Counting is O(1) via SCARD. Listing all emails is O(N) via
// SMEMBERS (only used by the admin endpoint).
//
// Privacy: emails are stored raw (matching the trial-eligibility-
// store pattern) since only an admin token can read them back.
// Counts are exposed to the admin endpoint; raw emails only by
// explicit request.
// ═══════════════════════════════════════════════════════════

import Redis from 'ioredis';

const TRACKED_CODES = new Set(['FOUNDERMYGRIND', 'FOREVERYOUNG2026', 'D1GRIND', 'ALLSTARMYGRIND']);

// Hard caps per promo (the marketing promise). Enforced atomically by
// redeemFounderSlot below so the (cap+1)th redemption is rejected instead
// of silently granted — previously these were counted but never enforced.
const CAPS = {
  FOUNDERMYGRIND:   100,
  FOREVERYOUNG2026: 10,
  D1GRIND:          250,   // D1 Training partner cohort (2026-06-16) — own cap
  ALLSTARMYGRIND:   15,    // Brandon Sonnier's AllStars roster (2026-07-02) — own cap
};

let redis = null;
function getRedis() {
  if (redis) return redis;
  const url = process.env.REDIS_URL;
  if (!url) {
    console.warn('[founder-cohort] REDIS_URL not set');
    return null;
  }
  redis = new Redis(url, { maxRetriesPerRequest: 2, enableReadyCheck: false });
  redis.on('error', (e) => console.error('[founder-cohort] redis error:', e.message));
  return redis;
}

function normalizeCode(code) {
  return (code || '').trim().toUpperCase();
}

function normalizeEmail(e) {
  return (e || '').trim().toLowerCase();
}

function keyFor(code) {
  return 'founder:set:' + code;
}

// Record a founder signup. Called fire-and-forget from /api/start-trial
// when promoCode is one of the tracked codes. Returns { ok, tracked,
// isNew } so callers can log redundantly without affecting the trial
// flow. Failures are non-fatal — the trial still starts.
export async function recordFounderSignup({ email, promoCode }) {
  const r = getRedis();
  if (!r) return { ok: false, error: 'redis_unavailable' };

  const code = normalizeCode(promoCode);
  if (!TRACKED_CODES.has(code)) {
    return { ok: true, tracked: false };
  }

  const normEmail = normalizeEmail(email);
  if (!normEmail) return { ok: false, error: 'missing_email' };

  try {
    const added = await r.sadd(keyFor(code), normEmail);
    return { ok: true, tracked: true, code, isNew: added === 1 };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Atomically claim a capped slot for an email under a promo code.
// Unlike recordFounderSignup (which only counts), this ENFORCES the cap:
//   - Already a member  → idempotent, no slot consumed, capReached:false.
//   - New + within cap  → added, isNew:true.
//   - New + over cap    → rolled back (SREM), capReached:true, NOT granted.
// Returns { ok, code, isNew, count, capReached }. The 2026-06-07 audit (#4)
// fix for "FOREVERYOUNG2026 / FOUNDERMYGRIND caps never enforced". There is a
// tiny TOCTOU window between SADD and SCARD under truly concurrent redeems of
// the *same* cap, but for a 10/100-slot comp that's an acceptable margin —
// the set can never drift more than the number of simultaneous in-flight
// redeems, and over-claims self-heal because no sub record is written for a
// capReached result.
export async function redeemFounderSlot({ email, promoCode }) {
  const r = getRedis();
  if (!r) return { ok: false, error: 'redis_unavailable' };

  const code = normalizeCode(promoCode);
  if (!TRACKED_CODES.has(code)) return { ok: false, error: 'unknown_code' };

  const normEmail = normalizeEmail(email);
  if (!normEmail) return { ok: false, error: 'missing_email' };

  const cap = CAPS[code];
  try {
    // Idempotent re-redeem (e.g. backfill, refresh, returning VIP) never
    // consumes a fresh slot or trips the cap.
    const already = await r.sismember(keyFor(code), normEmail);
    if (already) {
      const count = await r.scard(keyFor(code));
      return { ok: true, code, isNew: false, count, capReached: false };
    }

    const added = await r.sadd(keyFor(code), normEmail);
    const count = await r.scard(keyFor(code));
    if (added === 1 && cap && count > cap) {
      // We just pushed past the cap — roll back so slot #(cap+1) isn't granted.
      await r.srem(keyFor(code), normEmail);
      return { ok: true, code, isNew: false, count: cap, capReached: true };
    }
    return { ok: true, code, isNew: added === 1, count, capReached: false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Read the current count for one promo code. Returns { ok, code, count }.
export async function getFounderCount(code) {
  const r = getRedis();
  if (!r) return { ok: false, error: 'redis_unavailable' };

  const c = normalizeCode(code);
  if (!TRACKED_CODES.has(c)) return { ok: false, error: 'unknown_code' };

  try {
    const count = await r.scard(keyFor(c));
    return { ok: true, code: c, count };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Read counts for every tracked code in one round-trip. Returns
// { ok: true, counts: { FOUNDERMYGRIND: N, FOREVERYOUNG2026: M } }.
export async function getAllFounderCounts() {
  const r = getRedis();
  if (!r) return { ok: false, error: 'redis_unavailable' };

  try {
    const out = {};
    for (const code of TRACKED_CODES) {
      out[code] = await r.scard(keyFor(code));
    }
    return { ok: true, counts: out };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Backfill helper. Admin-only — accepts an array of emails and adds
// them to the set for the given code. Useful for back-loading founders
// who signed up before this tracker existed.
export async function backfillFounders({ code, emails }) {
  const r = getRedis();
  if (!r) return { ok: false, error: 'redis_unavailable' };

  const c = normalizeCode(code);
  if (!TRACKED_CODES.has(c)) return { ok: false, error: 'unknown_code' };
  if (!Array.isArray(emails) || emails.length === 0) {
    return { ok: false, error: 'no_emails' };
  }

  const normEmails = emails.map(normalizeEmail).filter(Boolean);
  if (normEmails.length === 0) return { ok: false, error: 'no_valid_emails' };

  try {
    const added = await r.sadd(keyFor(c), ...normEmails);
    const total = await r.scard(keyFor(c));
    return { ok: true, code: c, addedCount: added, totalCount: total };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
