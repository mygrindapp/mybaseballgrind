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
