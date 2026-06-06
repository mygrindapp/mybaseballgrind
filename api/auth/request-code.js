// ═══════════════════════════════════════════════════════════
// MyGrind — api/auth/request-code.js (6-digit sign-in code)
// ───────────────────────────────────────────────────────────
// Sends a 6-digit one-time code to the user's email. Replaces
// the magic-link flow because iOS PWA Home Screen apps cannot
// receive sign-in links from email — Apple opens link clicks
// in Safari, never the installed PWA, breaking magic-link auth
// for the majority of iOS PWA users (real-world: customer
// Brandon hit this 2026-05-25). Codes solve it because the user
// types the code into the same app surface they are signing in
// from, no cross-app handoff.
//
// Endpoint: POST /api/auth/request-code
// Body:    { email }
// Response:
//   200 { ok: true } — code sent (or rate-limited; we never echo
//                       per-email state to avoid enumeration)
//   400 { ok: false, error: 'missing_email' | 'invalid_email' }
//   429 { ok: false, error: 'rate_limited' }
//   500 { ok: false, error: 'server_misconfigured' | 'send_failed' }
//
// Code storage:
//   Redis key: signincode:<sha256(email).slice(0,16)>
//   Value:     sha256(code) hex
//   TTL:       15 minutes
//   Single-use: deleted on successful verify
//
// Rate limits:
//   Per-IP via shared lib/rate-limit.js (60/hr read tier)
//   Per-email: max 5 codes per hour. Anti-enumeration: on hit,
//   returns 200 ok identically to success path.
//
// Anti-enumeration: response shape is identical for valid /
// invalid / non-existent emails. Stripe sub presence and prior
// account state do not leak through this endpoint.
// ═══════════════════════════════════════════════════════════

import crypto from 'crypto';
import { Resend } from 'resend';
import Redis from 'ioredis';
import { checkIpReadLimit, recordRead } from '../../lib/rate-limit.js';

const ALLOWED_ORIGINS = new Set([
  'https://www.mygrindapp.com',
  'https://mygrindapp.com',
]);

const CODE_TTL_SECONDS = 15 * 60;
const EMAIL_RATE_TTL_SECONDS = 60 * 60;
const EMAIL_RATE_MAX = 5;

let _redis = null;
function getRedis() {
  if (_redis) return _redis;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  _redis = new Redis(url, { maxRetriesPerRequest: 2, enableReadyCheck: false });
  _redis.on('error', (e) => console.error('[auth/request-code] redis:', e.message));
  return _redis;
}

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

function emailKeyHash(email) {
  return crypto.createHash('sha256').update(email).digest('hex').slice(0, 16);
}

function sha256Hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function isValidEmail(e) {
  return typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
}

function formatCodeForDisplay(code) {
  return code.slice(0, 3) + ' ' + code.slice(3);
}

function buildEmailHtml({ code, email }) {
  const displayCode = formatCodeForDisplay(code);
  const text = [
    'Hey,',
    '',
    'Your MyGrind sign-in code is:',
    '',
    '    ' + displayCode,
    '',
    'Pop it into the MyGrind sign-in screen on your phone. It expires in 15 minutes.',
    '',
    'If you did not ask for this code, ignore the email. No one can sign in without it.',
    '',
    'See you in the journal.',
    'Coach',
    'The Grind',
  ].join('\n');

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0; padding:0; background:#0E0006; font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif; color:#F2EAD9;">
  <div style="max-width:560px; margin:0 auto; padding:32px 24px;">
    <div style="font-family:'Bebas Neue',sans-serif; font-size:28px; letter-spacing:2px; color:#E8C97A; margin-bottom:8px;">MY GRIND</div>
    <div style="height:2px; background:#B89A4B; width:64px; margin-bottom:28px;"></div>

    <p style="font-size:16px; line-height:1.6; color:#F2EAD9; margin:0 0 18px;">Hey,</p>

    <p style="font-size:16px; line-height:1.6; color:#F2EAD9; margin:0 0 18px;">
      Your MyGrind sign-in code is:
    </p>

    <div style="text-align:center; margin:0 0 24px;">
      <div style="display:inline-block; background:rgba(232,201,122,0.08); border:1px solid #B89A4B; border-radius:10px; padding:18px 32px; font-family:'SF Mono',Menlo,Consolas,monospace; font-size:32px; font-weight:700; letter-spacing:8px; color:#E8C97A;">${displayCode}</div>
    </div>

    <p style="font-size:15px; line-height:1.6; color:#F2EAD9; margin:0 0 24px;">
      Pop it into the MyGrind sign-in screen on your phone. <strong style="color:#E8C97A;">It expires in 15 minutes.</strong>
    </p>

    <div style="background:rgba(184,154,75,0.06); border:1px solid #B89A4B; border-radius:6px; padding:14px 16px; margin-bottom:28px;">
      <p style="font-size:13px; line-height:1.6; color:#F2EAD9; margin:0;">
        <strong style="color:#E8C97A;">Did not ask for this?</strong> Ignore the email. No one can sign in without the code.
      </p>
    </div>

    <p style="font-size:15px; line-height:1.4; color:#F2EAD9; margin:0;">See you in the journal.</p>
    <p style="font-size:15px; line-height:1.4; color:#F2EAD9; margin:4px 0 0;">Coach</p>
    <p style="font-family:'Barlow Condensed',sans-serif; font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#B89A4B; margin:4px 0 0;">The Grind</p>
  </div>
</body></html>`;

  return { html, text };
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const resendKey = process.env.RESEND_API_KEY;
  const redis     = getRedis();
  if (!resendKey || !redis) {
    console.error('[auth/request-code] missing env (RESEND_API_KEY or REDIS_URL)');
    return res.status(500).json({ ok: false, error: 'server_misconfigured' });
  }

  const clientIp = getClientIp(req);
  const ipCheck = await checkIpReadLimit(clientIp);
  if (!ipCheck.ok) {
    console.warn('[auth/request-code] IP rate limited', { ipHash: piiHash(clientIp) });
    return res.status(429).json({ ok: false, error: 'rate_limited' });
  }
  await recordRead(clientIp);

  const { email } = req.body || {};
  if (!email) {
    return res.status(400).json({ ok: false, error: 'missing_email' });
  }
  const normEmail = String(email).trim().toLowerCase();
  if (!isValidEmail(normEmail)) {
    return res.status(400).json({ ok: false, error: 'invalid_email' });
  }

  const emailHash = emailKeyHash(normEmail);

  // Per-email send-rate limit. Anti-enumeration: on hit, return 200 ok
  // identically to the success path (never reveal whether limited).
  const rateKey = 'signincode-rate:' + emailHash;
  try {
    const count = await redis.incr(rateKey);
    if (count === 1) {
      await redis.expire(rateKey, EMAIL_RATE_TTL_SECONDS);
    }
    if (count > EMAIL_RATE_MAX) {
      console.warn('[auth/request-code] per-email rate hit', { emailHash: piiHash(normEmail), count });
      return res.status(200).json({ ok: true });
    }
  } catch (e) {
    console.error('[auth/request-code] redis rate failed:', e.message);
    return res.status(500).json({ ok: false, error: 'storage_failed' });
  }

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const codeHash = sha256Hex(code);
  const codeKey = 'signincode:' + emailHash;

  try {
    await redis.set(codeKey, codeHash, 'EX', CODE_TTL_SECONDS);
    // Reset the verify-attempt counter so this freshly-issued code starts with
    // a clean 5-try budget. Without this, a user who fat-fingered the PREVIOUS
    // code into the lockout (attempts > 5) stayed locked for up to 15 minutes
    // even after requesting a new code. The per-email code-send cap (5/hr) is
    // the real brute-force bound, so resetting attempts on resend is safe.
    await redis.del('signincode-att:' + emailHash);
  } catch (e) {
    console.error('[auth/request-code] redis SET failed:', e.message);
    return res.status(500).json({ ok: false, error: 'storage_failed' });
  }

  const from         = process.env.RESEND_FROM || 'MyGrind <coach@mygrindapp.com>';
  const testRedirect = process.env.WEEKLY_DIGEST_TEST_EMAIL || '';
  const to           = testRedirect || normEmail;
  const { html, text } = buildEmailHtml({ code, email: normEmail });

  try {
    const resend = new Resend(resendKey);
    const result = await resend.emails.send({
      from,
      to,
      subject: 'Your MyGrind sign-in code',
      html,
      text,
      replyTo: 'coach@mygrindapp.com',
    });
    console.log('[auth/request-code] sent', {
      toHash:     piiHash(to),
      redirected: !!testRedirect,
      resendId:   result?.data?.id || null,
    });
  } catch (e) {
    console.error('[auth/request-code] send failed:', e.message);
    return res.status(500).json({ ok: false, error: 'send_failed' });
  }

  return res.status(200).json({ ok: true });
}
