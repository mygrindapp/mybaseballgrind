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

const TRACKED_CODES = new Set(['FOUNDERMYGRIND', 'FOREVERYOUNG2026']);

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
