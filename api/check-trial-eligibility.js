// ═══════════════════════════════════════════════════════════
// MyGrind — api/check-trial-eligibility.js
// ───────────────────────────────────────────────────────────
// Trial-abuse prevention (Tier 1, 2026-05-18 Coach Young call).
//
// Called by signup.html when the parent has provided both email
// AND phone (or after Screen 6 where player phone is collected),
// BEFORE the user reaches the Pay/Start-Trial screen. Returns
// whether the email + phone combination is eligible to start
// a new free trial.
//
// Response shape:
//   200 { ok: true, eligible: true }
//   200 { ok: true, eligible: false, reason: 'email_used' | 'phone_used' }
//   400 { ok: false, error: 'missing_fields' }
//   429 { ok: false, error: 'rate_limited' }
//
// IMPORTANT: We return 200 (not 4xx) when ineligible. Why: the
// signup UX needs to handle the "already trialed" case as a
// graceful soft-redirect, not as an HTTP error. A 4xx would
// trigger generic browser error handling.
// ═══════════════════════════════════════════════════════════

import crypto from 'crypto';
import { checkTrialEligibility } from '../lib/trial-eligibility-store.js';
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

  const { email, phone } = req.body || {};

  // At least one identifier must be present. signup.html should
  // typically send both, but the lib gracefully handles partial.
  if (!email && !phone) {
    return res.status(400).json({ ok: false, error: 'missing_fields' });
  }

  // ─── Read-tier rate limit ────────────────────────────────
  // Same limiter as feedback-list/feedback-get. Defeats bulk
  // enumeration ("does this email/phone have an account?") without
  // rate-limiting legit signups out of the funnel. 60/hr 600/day.
  const clientIp = getClientIp(req);
  const ipCheck = await checkIpReadLimit(clientIp);
  if (!ipCheck.ok) {
    console.warn('[check-trial-eligibility] IP rate limited', { ipHash: piiHash(clientIp), reason: ipCheck.reason });
    return res.status(429).json({ ok: false, error: 'rate_limited' });
  }
  await recordRead(clientIp);

  // ─── Eligibility check ───────────────────────────────────
  const result = await checkTrialEligibility({ email, phone });

  // Log the decision with hashed identifiers so we can debug
  // false-positives without storing PII.
  console.log('[check-trial-eligibility]', {
    emailHash: piiHash(email),
    phoneHash: piiHash(phone),
    eligible: result.eligible,
    reason: result.reason || null,
  });

  return res.status(200).json({
    ok: true,
    eligible: result.eligible,
    reason: result.reason || null,
  });
}
