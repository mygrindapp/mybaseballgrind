// ═══════════════════════════════════════════════════════════
// MyGrind — api/start-trial.js
// ───────────────────────────────────────────────────────────
// Trial-abuse prevention (Tier 1, 2026-05-18 Coach Young call).
//
// Called by signup.html the moment a fresh signup reaches Screen 8
// (the post-signup dashboard — the canonical "trial just started"
// moment in MyGrind's funnel today). Performs an ATOMIC check-and-
// record:
//   1. Look up trial:email:<email> and trial:phone:<phone> in Redis
//   2. If either exists → return { ok:true, started:false, reason }
//   3. Otherwise SET NX both records → return { ok:true, started:true }
//
// The atomic combine prevents the race where two parallel signups
// could both pass the check then both record. Idempotent — calling
// twice from the same browser (e.g., refresh) returns started:false
// on the second call without breaking anything.
//
// Response shape:
//   200 { ok: true, started: true }
//   200 { ok: true, started: false, reason: 'email_used' | 'phone_used' }
//   400 { ok: false, error: 'missing_fields' }
//   429 { ok: false, error: 'rate_limited' }
//
// Belt-and-suspenders: stripe-webhook.js also records trial-used on
// customer.subscription.created. send-invite.js also records when
// SMS is sent. Multiple call sites cover the different flows; all
// recordings are idempotent via SET NX.
// ═══════════════════════════════════════════════════════════

import crypto from 'crypto';
import { checkTrialEligibility, recordTrialUsed } from '../lib/trial-eligibility-store.js';
import { recordFounderSignup } from '../lib/founder-cohort-store.js';
import { checkIpReadLimit, recordRead } from '../lib/rate-limit.js';

const ALLOWED_ORIGINS = new Set([
  'https://www.mygrindapp.com',
  'https://mygrindapp.com',
]);

function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers['x-real-ip'] || null;
}

function piiHash(value) {
  if (!value) return 'none';
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 8);
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const { email, phone, promoCode } = req.body || {};
  if (!email && !phone) {
    return res.status(400).json({ ok: false, error: 'missing_fields' });
  }

  // ─── Read-tier rate limit ────────────────────────────────
  // Same limiter as check-trial-eligibility. Defeats bulk abuse
  // without rate-limiting legit signups.
  const clientIp = getClientIp(req);
  const ipCheck = await checkIpReadLimit(clientIp);
  if (!ipCheck.ok) {
    console.warn('[start-trial] IP rate limited', { ipHash: piiHash(clientIp), reason: ipCheck.reason });
    return res.status(429).json({ ok: false, error: 'rate_limited' });
  }
  await recordRead(clientIp);

  // ─── Atomic check + record ────────────────────────────────
  // Check first, then record. There's a TOCTOU race between the
  // check and the record if two parallel signups arrive at the
  // same instant, but recordTrialUsed uses Redis SET NX which is
  // atomic at the server — only the first SET wins. So in the
  // worst case, two parallel signups both PASS the eligibility
  // check, but only one wins the SET NX. The "loser" gets the
  // trial recorded against them too (since SET NX returns nil for
  // the loser, indicating the key already existed). The recordTrialUsed
  // 'recorded' array tells us which side actually wrote.
  //
  // We treat: any recordTrialUsed call where 'recorded' is empty
  // (nothing new written) as if the trial was already used — for
  // honest users this can only happen if they're hitting refresh.
  const elig = await checkTrialEligibility({ email, phone });
  if (!elig.eligible) {
    console.log('[start-trial] ineligible', {
      emailHash: piiHash(email),
      phoneHash: piiHash(phone),
      reason: elig.reason,
    });
    return res.status(200).json({
      ok: true,
      started: false,
      reason: elig.reason || 'already_used',
    });
  }

  const rec = await recordTrialUsed({
    email,
    phone,
    source: 'start-trial',
  });

  if (!rec.ok) {
    // Redis write failed. Fail-open: let the user proceed but log
    // loudly so we can investigate. The downside of fail-open here
    // is one trial slips through during a Redis blip — acceptable.
    console.error('[start-trial] record failed (fail-open)', {
      emailHash: piiHash(email),
      phoneHash: piiHash(phone),
      error: rec.error,
    });
    return res.status(200).json({ ok: true, started: true, warning: 'storage_blip' });
  }

  // If recorded is empty, the keys already existed — race lost OR
  // the user is hitting refresh. Either way, we count this as
  // "already trialed" so the client redirects appropriately.
  if (!rec.recorded || rec.recorded.length === 0) {
    console.log('[start-trial] no new keys (already trialed or race lost)', {
      emailHash: piiHash(email),
      phoneHash: piiHash(phone),
    });
    return res.status(200).json({
      ok: true,
      started: false,
      reason: 'already_used',
    });
  }

  console.log('[start-trial] trial started', {
    emailHash: piiHash(email),
    phoneHash: piiHash(phone),
    recorded: rec.recorded,
  });

  // ─── Founder-cohort tracking ──────────────────────────────
  // Record founders in a Redis Set keyed by promo code so the
  // 100-cap on FOUNDERMYGRIND (and 10-cap on FOREVERYOUNG2026)
  // has a real server-side count. Fire-and-forget — never blocks
  // or fails the trial start. Idempotent via SADD semantics.
  if (promoCode && email) {
    try {
      const founderRes = await recordFounderSignup({ email, promoCode });
      if (founderRes.ok && founderRes.tracked) {
        console.log('[start-trial] founder recorded', {
          emailHash: piiHash(email),
          code: founderRes.code,
          isNew: founderRes.isNew,
        });
      } else if (!founderRes.ok) {
        console.warn('[start-trial] founder record failed', { error: founderRes.error });
      }
    } catch (e) {
      console.warn('[start-trial] founder record threw', { error: e && e.message });
    }
  }

  return res.status(200).json({ ok: true, started: true });
}
