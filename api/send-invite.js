// Phase 3c additions:
//   - Per-IP rate limit (3/hr, 10/day) checked before Twilio
//   - Per-phone rate limit (2/24h) checked before Twilio
//   - Generic 429 response on rate limit (no info leak)
//   - Counter increment on attempt (after rate limit checks pass,
//     before Twilio) — see Option C decision in the inline comment
//
// Phase 3d additions (2026-05-02):
//   - Twilio Lookup v2 pre-check between E.164 normalize and rate
//     limit checks. Catches landlines / VoIP / invalid numbers
//     BEFORE we burn rate-limit budget or attempt a paid SMS send.
//   - Friendly user-facing error messages per rejection reason.
//   - Fail-open on Lookup outage (signups keep working).
//
// DRY_RUN sends DO increment counters in this version. Trade-off
// accepted: protection works even when Twilio is misbehaving.
//
// Locked spec: Notion "🛠️ Phase 3 — Twilio SMS Backend Architecture"
// ═══════════════════════════════════════════════════════════

import twilio from 'twilio';
import crypto from 'crypto';
import { checkIpLimit, checkPhoneLimit, recordSend } from '../lib/rate-limit.js';
import { lookupPhone } from '../lib/lookup.js';
import { checkTrialEligibility, recordTrialUsed } from '../lib/trial-eligibility-store.js';

// Short-hash PII for Vercel logs (H3 — security audit 2026-05-18).
// Phone numbers stay greppable across log entries (same phone → same hash)
// without sitting in cleartext where any teammate with Vercel project
// access can read them. 8-char SHA-256 prefix.
function piiHash(value) {
  if (!value) return 'none';
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 8);
}

// ─── Config flags ─────────────────────────────────────────
const DRY_RUN = process.env.SMS_DRY_RUN !== 'false';

// ─── SMS body builder ─────────────────────────────────────
function buildSmsBody({ parentName, playerName, sport }) {
  const sportLabel =
    sport === 'softball' ? 'softball' :
    sport === 'both'     ? 'baseball/softball' :
                           'baseball';

  const onboardingUrl =
    `https://mygrindapp.com/onboarding.html` +
    `?name=${encodeURIComponent(playerName)}` +
    `&sport=${encodeURIComponent(sport)}`;

  // GSM-7 only (no em-dashes, no smart quotes) so each segment is 153 chars, not 67.
  return (
    `Hey ${playerName}, ${parentName} signed you up for MyGrind - ` +
    `the ${sportLabel} journal for tracking your stats, games, and growth.\n\n` +
    `Set up your profile (3 min): ${onboardingUrl}`
  );
}

// ─── E.164 phone normalization ────────────────────────────
function toE164(phone) {
  if (!phone || typeof phone !== 'string') return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

// ─── Extract real client IP ───────────────────────────────
// Vercel sets x-forwarded-for and x-real-ip headers. The first
// IP in x-forwarded-for is the actual client. Fall back to
// x-real-ip if not available.
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.headers['x-real-ip'] || null;
}

// Allowlist for CORS — only mygrindapp.com origins can call this endpoint.
// A malicious site embedding our API would still hit rate limits, but the
// allowlist prevents wasting any rate-limit budget on third-party callers.
const ALLOWED_ORIGINS = new Set([
  'https://www.mygrindapp.com',
  'https://mygrindapp.com',
]);

export default async function handler(req, res) {
  // ─── CORS headers ────────────────────────────────────────
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed',
    });
  }

  // ─── Request shape validation ────────────────────────────
  // parentEmail added 2026-05-18 for trial-abuse prevention (Tier 1).
  // Optional in v1 — older clients can still call without it. When present,
  // it's checked against the trial-eligibility-store + recorded at success.
  const { parentName, playerName, playerPhone, sport, signupSessionId, parentEmail } = req.body || {};

  const missing = [];
  if (!parentName       || typeof parentName       !== 'string') missing.push('parentName');
  if (!playerName       || typeof playerName       !== 'string') missing.push('playerName');
  if (!playerPhone      || typeof playerPhone      !== 'string') missing.push('playerPhone');
  if (!sport            || typeof sport            !== 'string') missing.push('sport');
  if (!signupSessionId  || typeof signupSessionId  !== 'string') missing.push('signupSessionId');

  if (missing.length > 0) {
    console.warn('[send-invite] Bad request — missing fields:', missing);
    return res.status(400).json({
      success: false,
      error: 'Bad request',
    });
  }

  // ─── Phone normalization ─────────────────────────────────
  const e164Phone = toE164(playerPhone);
  if (!e164Phone) {
    console.warn('[send-invite] Invalid phone format:', { phoneHash: piiHash(playerPhone) });
    return res.status(400).json({
      success: false,
      error: 'Invalid phone number',
    });
  }

  // ─── Trial eligibility check (Tier 1 abuse prevention) ──
  // Belt-and-suspenders: signup.html SHOULD have already gated the
  // user before they reached this endpoint via /api/check-trial-eligibility.
  // But a determined abuser could call /api/send-invite directly and
  // bypass the client check. Re-validate here. Fail-open on Redis
  // outage matches the rate-limit + lookup behavior.
  const trial = await checkTrialEligibility({ email: parentEmail, phone: e164Phone });
  if (!trial.eligible) {
    console.warn('[send-invite] trial ineligible', { reason: trial.reason, signupSessionId });
    return res.status(409).json({
      success: false,
      error: trial.reason === 'email_used'
        ? 'It looks like this email already has a MyGrind account. Sign in or email support@mygrindapp.com.'
        : 'It looks like this phone number already has a MyGrind account. Sign in or email support@mygrindapp.com.',
      code: 'TRIAL_USED',
      reason: trial.reason,
    });
  }

  // ─── Twilio Lookup pre-check (Phase 3d) ──────────────────
  // Verify number is real and mobile-textable BEFORE we burn
  // rate-limit budget or attempt a paid send. Fail-open on
  // Twilio Lookup outage so signups keep flowing.
  const lookup = await lookupPhone(e164Phone);
  if (!lookup.ok) {
    console.warn('[send-invite] Lookup rejected number:', { reason: lookup.reason, signupSessionId });
    return res.status(400).json({
      success: false,
      error: lookup.message || 'That phone number cannot receive text invites.',
      code: 'INVALID_PHONE_LINE',
      reason: lookup.reason,
    });
  }

  // ─── Rate limit checks (Phase 3c) ────────────────────────
  // Two checks before we do anything expensive (Twilio costs
  // ~$0.008/send). Generic error on rate limit per locked spec.
  const clientIp = getClientIp(req);

  const ipCheck = await checkIpLimit(clientIp);
  if (!ipCheck.ok) {
    console.warn('[send-invite] IP rate limited:', { ip: clientIp ? '[redacted]' : 'none', reason: ipCheck.reason, signupSessionId });
    return res.status(429).json({
      success: false,
      error: 'Too many requests, try again later',
      code: 'RATE_LIMITED',
    });
  }

  const phoneCheck = await checkPhoneLimit(e164Phone);
  if (!phoneCheck.ok) {
    console.warn('[send-invite] Phone rate limited:', { reason: phoneCheck.reason, signupSessionId });
    return res.status(429).json({
      success: false,
      error: 'Too many requests, try again later',
      code: 'RATE_LIMITED',
    });
  }

  // ─── Record attempt for rate limiting (Phase 3c, Option C) ─
  // Increment counters NOW, before Twilio. Reasons:
  //   1. Protects against bursts even when Twilio is misbehaving
  //   2. Counters reflect "attempted sends" not "successful sends"
  //   3. Trade-off: a legit user whose Twilio fails burns one
  //      attempt — acceptable cost for stronger protection
  await recordSend(clientIp, e164Phone);

  // ─── Build SMS body ──────────────────────────────────────
  const smsBody = buildSmsBody({ parentName, playerName, sport });
 // ─── DRY RUN path ────────────────────────────────────────
  // recordSend() already fired above (Option C architecture).
  // DRY_RUN responses count against rate limits — that's
  // intentional, so testing simulates real protection behavior.
  if (DRY_RUN) {
    // DRY_RUN log: hash recipient phone, omit full body (contains player
    // first name in plaintext). Keep bodyLength so we can verify SMS
    // segment count without storing PII. H3 — security audit 2026-05-18.
    console.log('[send-invite DRY_RUN] Would send SMS:', {
      toHash: piiHash(e164Phone),
      bodyLength: smsBody.length,
      signupSessionId,
    });

    // Record trial-used even in DRY_RUN. The user has completed the
    // signup flow — they've consumed their free trial. SMS delivery
    // status doesn't change that. Idempotent via SET NX in the store.
    try {
      const r = await recordTrialUsed({
        email: parentEmail,
        phone: e164Phone,
        source: 'send-invite-dry-run',
      });
      if (r.recorded && r.recorded.length) {
        console.log('[send-invite] trial recorded (DRY_RUN):', { recorded: r.recorded, signupSessionId });
      }
    } catch (e) { /* fail-open — never block signup on bookkeeping error */ }

    return res.status(200).json({
      success: true,
      smsSid: 'DRY-RUN-NO-MESSAGE-SENT',
      sentAt: new Date().toISOString(),
      phase: '3c-dry-run',
      dryRun: true,
      previewBody: smsBody,
    });
  }

  // ─── REAL SEND path ──────────────────────────────────────
  try {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken  = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_FROM_NUMBER;

    if (!accountSid || !authToken || !fromNumber) {
      console.error('[send-invite] Missing Twilio env vars');
      return res.status(500).json({
        success: false,
        error: 'Server misconfigured',
      });
    }

    const client = twilio(accountSid, authToken);

    const message = await client.messages.create({
      body: smsBody,
      from: fromNumber,
      to:   e164Phone,
    });

    // ─── recordSend() already fired before Twilio (Option C) ─
    // Counter increment happens before this block. No double-count here.

    console.log('[send-invite] SMS sent:', {
      smsSid: message.sid,
      signupSessionId,
    });

    // Record trial-used after a real successful SMS send. This is the
    // canonical "signup completed" event in the funnel today. Idempotent
    // via SET NX. Never blocks the signup response on bookkeeping error.
    try {
      const r = await recordTrialUsed({
        email: parentEmail,
        phone: e164Phone,
        source: 'send-invite-live',
      });
      if (r.recorded && r.recorded.length) {
        console.log('[send-invite] trial recorded:', { recorded: r.recorded, signupSessionId });
      }
    } catch (e) { /* fail-open — never block signup on bookkeeping error */ }

    return res.status(200).json({
      success: true,
      smsSid: message.sid,
      sentAt: new Date().toISOString(),
      phase: '3c-live',
    });

  } catch (err) {
    console.error('[send-invite] Twilio error:', {
      code: err.code,
      message: err.message,
      status: err.status,
      signupSessionId,
    });

    return res.status(500).json({
      success: false,
      error: 'Could not send invite',
      code: 'SEND_FAILED',
    });
  }
}
