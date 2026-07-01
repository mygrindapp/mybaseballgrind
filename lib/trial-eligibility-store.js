// ═══════════════════════════════════════════════════════════
// MyGrind — lib/trial-eligibility-store.js
// ───────────────────────────────────────────────────────────
// Trial-abuse prevention (Tier 1, 2026-05-18 Coach Young call).
//
// The free trial is the most valuable real estate in the funnel —
// once a user has had their 14 days, they should not be able to
// reset the timer by signing up again with the same email or phone.
//
// This module records which emails and phone numbers have ALREADY
// been used to start a trial. Records are PERMANENT (no TTL) so
// the block survives Redis evictions and persists for the lifetime
// of the platform.
//
// Key shape:
//   trial:email:<lowercased-email>   → JSON { recordedAt, source }
//   trial:phone:<E164-phone>         → JSON { recordedAt, source }
//
// Privacy note: We don't store names or any other PII in these
// keys. Just a timestamp and a `source` tag identifying which
// endpoint recorded the use (helps with debugging).
//
// Edge cases handled:
//   - Mistyped email at signup: Support manually deletes the key
//     to let the user retry. There's no automatic TTL because that
//     would create an abuse window.
//   - User changes phone number legitimately: their original phone
//     is still blocked, but they can sign up with the new phone. Old
//     trial-block persists forever (we never know it's stale).
//   - SET NX semantics: recordTrialUsed is idempotent — if the same
//     email tries to sign up twice (e.g., a network retry), the
//     second call is a no-op. The FIRST call wins.
// ═══════════════════════════════════════════════════════════

import Redis from 'ioredis';

let redis = null;
function getRedis() {
  if (redis) return redis;
  const url = process.env.REDIS_URL;
  if (!url) {
    console.warn('[trial-eligibility] REDIS_URL not set');
    return null;
  }
  redis = new Redis(url, { maxRetriesPerRequest: 2, enableReadyCheck: false });
  redis.on('error', (e) => console.error('[trial-eligibility] redis error:', e.message));
  return redis;
}

function normalizeEmail(e) {
  return (e || '').trim().toLowerCase();
}

function normalizePhoneE164(p) {
  if (!p) return null;
  const digits = String(p).replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return null;
}

// ─── CHECK ────────────────────────────────────────────────
// Returns one of:
//   { eligible: true }
//   { eligible: false, reason: 'email_used' }
//   { eligible: false, reason: 'phone_used' }
// On Redis outage we FAIL OPEN (return eligible: true) so legit
// signups keep flowing during an infra blip. Pre-launch tradeoff
// matches the rest of the rate-limit + lookup stack.
export async function checkTrialEligibility({ email, phone }) {
  const r = getRedis();
  if (!r) return { eligible: true };

  const normEmail = normalizeEmail(email);
  const normPhone = normalizePhoneE164(phone);

  // Both must be provided. Caller validates before calling.
  if (!normEmail && !normPhone) {
    return { eligible: true };
  }

  try {
    const checks = [];
    if (normEmail) checks.push(r.exists('trial:email:' + normEmail));
    else            checks.push(Promise.resolve(0));
    if (normPhone) checks.push(r.exists('trial:phone:' + normPhone));
    else            checks.push(Promise.resolve(0));
    // Also check the subscription store — if a paid customer record
    // exists for this email under any status, treat the email as used.
    // This catches the case where a parent signed up, paid (or trialed),
    // canceled, and is now trying again. The subscription-store keeps
    // sub:<email> records forever.
    if (normEmail) checks.push(r.exists('sub:' + normEmail));
    else            checks.push(Promise.resolve(0));

    const [emailUsed, phoneUsed, subExists] = await Promise.all(checks);

    if (Number(emailUsed) > 0 || Number(subExists) > 0) {
      return { eligible: false, reason: 'email_used' };
    }
    if (Number(phoneUsed) > 0) {
      return { eligible: false, reason: 'phone_used' };
    }
    return { eligible: true };
  } catch (e) {
    console.error('[trial-eligibility] check failed:', e.message);
    return { eligible: true }; // fail-open
  }
}

// ─── RECORD ───────────────────────────────────────────────
// Called when a signup completes (treated as "trial started").
// Idempotent — uses SET NX so re-calls during retries don't
// overwrite the original recordedAt timestamp.
//
// Returns { ok: true, recorded: [...] } or { ok: false, error: ... }
export async function recordTrialUsed({ email, phone, source }) {
  const r = getRedis();
  if (!r) return { ok: false, error: 'storage_unavailable' };

  const normEmail = normalizeEmail(email);
  const normPhone = normalizePhoneE164(phone);
  if (!normEmail && !normPhone) {
    return { ok: false, error: 'no_identifiers' };
  }

  const payload = JSON.stringify({
    recordedAt: new Date().toISOString(),
    source: source || 'unknown',
  });

  try {
    const recorded = [];
    if (normEmail) {
      // NX = only set if key does not exist. Idempotent.
      const r1 = await r.set('trial:email:' + normEmail, payload, 'NX');
      if (r1 === 'OK') recorded.push('email');
    }
    if (normPhone) {
      const r2 = await r.set('trial:phone:' + normPhone, payload, 'NX');
      if (r2 === 'OK') recorded.push('phone');
    }
    return { ok: true, recorded };
  } catch (e) {
    console.error('[trial-eligibility] record failed:', e.message);
    return { ok: false, error: 'write_failed' };
  }
}

// ─── LIST ALL TRIALS (coach visibility, read-only) ───────
// Enumerates every trial:email:<x> record via a non-blocking SCAN
// (never KEYS — that blocks Redis). For each email we also check
// whether a sub:<email> record exists so the caller can separate
// "still on a no-card/free trial" from "converted to paid".
//
// WHY THIS EXISTS: a no-card trial writes trial:email:<x> here but
// only creates a Firebase Auth identity if the user later enters the
// emailed sign-in code. So a trial-starter who never enters the code
// is invisible in BOTH the Firebase Auth list AND Stripe. This is the
// only place that person is recorded. Cross-reference the returned
// emails against the Firebase Auth list to find the truly-invisible.
//
// Read-only: no writes, no deletes. Safe to call from an admin
// dashboard on any cadence. Scales fine into the low thousands; if the
// trial set ever gets huge, add pagination on the SCAN cursor.
//
// Returns { ok: true, count, converted, active, trials: [
//   { email, recordedAt, source, hasSub } ] }
export async function listAllTrials() {
  const r = getRedis();
  if (!r) return { ok: false, error: 'storage_unavailable' };

  try {
    // 1) SCAN for every trial:email:* key (cursor loop, COUNT 200 hint).
    const prefix = 'trial:email:';
    const keys = [];
    let cursor = '0';
    do {
      const [next, batch] = await r.scan(cursor, 'MATCH', prefix + '*', 'COUNT', 200);
      cursor = next;
      if (batch && batch.length) keys.push(...batch);
    } while (cursor !== '0');

    if (keys.length === 0) {
      return { ok: true, count: 0, converted: 0, active: 0, trials: [] };
    }

    // 2) Pipeline the payload GETs and the sub:<email> EXISTS checks so
    //    the whole enumeration is 2 round-trips regardless of key count.
    const emails = keys.map((k) => k.slice(prefix.length));

    const valPipe = r.pipeline();
    keys.forEach((k) => valPipe.get(k));
    const valRes = await valPipe.exec();

    const subPipe = r.pipeline();
    emails.forEach((e) => subPipe.exists('sub:' + e));
    const subRes = await subPipe.exec();

    const trials = emails.map((email, i) => {
      let recordedAt = null;
      let source = null;
      try {
        const raw = valRes[i] && valRes[i][1];
        if (raw) {
          const parsed = JSON.parse(raw);
          recordedAt = parsed.recordedAt || null;
          source = parsed.source || null;
        }
      } catch (_) { /* corrupt payload — leave nulls */ }
      const hasSub = subRes[i] && Number(subRes[i][1]) > 0;
      return { email, recordedAt, source, hasSub: !!hasSub };
    });

    // Freshest first when we have timestamps.
    trials.sort((a, b) => String(b.recordedAt || '').localeCompare(String(a.recordedAt || '')));

    const converted = trials.filter((t) => t.hasSub).length;
    return {
      ok:        true,
      count:     trials.length,
      converted,                            // trial-starters who now have a sub:<email>
      active:    trials.length - converted, // still on a no-card / unpaid trial
      trials,
    };
  } catch (e) {
    console.error('[trial-eligibility] listAllTrials failed:', e.message);
    return { ok: false, error: 'scan_failed' };
  }
}

// ─── MANUAL UNBLOCK (support-only) ────────────────────────
// Not exposed via API — call from a Vercel function manually or
// directly via redis-cli when a legit user emails support claiming
// they need to retry. Returns { ok, removed: [...] }.
export async function manualUnblock({ email, phone }) {
  const r = getRedis();
  if (!r) return { ok: false, error: 'storage_unavailable' };

  const normEmail = normalizeEmail(email);
  const normPhone = normalizePhoneE164(phone);
  const removed = [];
  try {
    if (normEmail) {
      const n = await r.del('trial:email:' + normEmail);
      if (n > 0) removed.push('email:' + normEmail);
    }
    if (normPhone) {
      const n = await r.del('trial:phone:' + normPhone);
      if (n > 0) removed.push('phone:' + normPhone);
    }
    return { ok: true, removed };
  } catch (e) {
    console.error('[trial-eligibility] unblock failed:', e.message);
    return { ok: false, error: 'delete_failed' };
  }
}
