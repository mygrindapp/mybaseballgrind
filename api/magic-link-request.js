// ═══════════════════════════════════════════════════════════
// MyGrind — api/magic-link-request.js (branded sign-in email)
// ───────────────────────────────────────────────────────────
// Sends a Resend-branded sign-in link to the user's email. Replaces
// Firebase's built-in sendSignInLinkToEmail (generic template, sent
// from noreply@my-grind-b8486.firebaseapp.com) with a warm-dark
// MyGrind email from coach@mygrindapp.com.
//
// Endpoint: POST /api/magic-link-request
// Body:    { email }
// Response:
//   200 { ok: true } — link sent (or would have been; we don't echo
//                       success per-email to avoid email-enumeration)
//   400 { ok: false, error: 'missing_email' | 'invalid_email' }
//   429 { ok: false, error: 'rate_limited' }
//   500 { ok: false, error: 'server_misconfigured' | 'send_failed' }
//
// Token storage:
//   Redis key: magiclink:<token>  →  email (lowercase, trimmed)
//   TTL: 15 minutes. One-time use — verify endpoint deletes on consume.
//
// Security:
//   - Per-IP rate limit via existing read-tier limiter.
//   - Token is 32 hex chars (16 random bytes from crypto.randomBytes).
//   - Email-enumeration defense: response is identical for valid /
//     invalid / non-existent emails. Stripe sub presence does not
//     leak through this endpoint.
// ═══════════════════════════════════════════════════════════

import crypto from 'crypto';
import { Resend } from 'resend';
import Redis from 'ioredis';
import { checkIpReadLimit, recordRead } from '../lib/rate-limit.js';

const ALLOWED_ORIGINS = new Set([
  'https://www.mygrindapp.com',
  'https://mygrindapp.com',
]);

let _redis = null;
function getRedis() {
  if (_redis) return _redis;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  _redis = new Redis(url, { maxRetriesPerRequest: 2, enableReadyCheck: false });
  _redis.on('error', (e) => console.error('[magic-link-request] redis:', e.message));
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

function isValidEmail(e) {
  return typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
}

// Warm-dark branded HTML matching the cancellation email shipped earlier
// today (api/stripe-webhook.js sendCancellationEmail) — same color tokens,
// same Bebas Neue + gold accent treatment, so the brand reads consistent
// inbox to inbox.
function buildEmailHtml({ signinUrl, email }) {
  const text = [
    'Hey there,',
    '',
    'You asked to sign in to MyGrind. Tap the link below to finish — it works once and expires in 15 minutes.',
    '',
    signinUrl,
    '',
    "Didn't request this? Ignore the email. No one can sign in without tapping the link.",
    '',
    'Coach',
    'The Grind',
  ].join('\n');

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0; padding:0; background:#0E0006; font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif; color:#F2EAD9;">
  <div style="max-width:560px; margin:0 auto; padding:32px 24px;">
    <div style="font-family:'Bebas Neue',sans-serif; font-size:28px; letter-spacing:2px; color:#E8C97A; margin-bottom:8px;">MY GRIND</div>
    <div style="height:2px; background:#B89A4B; width:64px; margin-bottom:28px;"></div>

    <p style="font-size:16px; line-height:1.6; color:#F2EAD9; margin:0 0 18px;">Hey there,</p>

    <p style="font-size:16px; line-height:1.6; color:#F2EAD9; margin:0 0 24px;">
      You asked to sign in to MyGrind. Tap the button below to finish. <strong style="color:#E8C97A;">This link works once and expires in 15 minutes.</strong>
    </p>

    <div style="text-align:center; margin:0 0 28px;">
      <a href="${signinUrl}" style="display:inline-block; background:#E8C97A; color:#080808; font-family:'Barlow Condensed',sans-serif; font-size:13px; font-weight:800; letter-spacing:2px; text-transform:uppercase; padding:16px 28px; border-radius:8px; text-decoration:none;">Sign In to MyGrind →</a>
    </div>

    <p style="font-size:13px; line-height:1.6; color:#9F9486; margin:0 0 18px;">
      Or copy this link into your browser:<br>
      <a href="${signinUrl}" style="color:#E8C97A; text-decoration:none; word-break:break-all;">${signinUrl}</a>
    </p>

    <div style="background:rgba(184,154,75,0.06); border:1px solid #B89A4B; border-radius:6px; padding:14px 16px; margin-bottom:28px;">
      <p style="font-size:13px; line-height:1.6; color:#F2EAD9; margin:0;">
        <strong style="color:#E8C97A;">Didn't request this?</strong> Ignore the email. No one can sign in without tapping the link.
      </p>
    </div>

    <p style="font-size:15px; line-height:1.4; color:#F2EAD9; margin:0;">Coach</p>
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
    console.error('[magic-link-request] missing env (RESEND_API_KEY or REDIS_URL)');
    return res.status(500).json({ ok: false, error: 'server_misconfigured' });
  }

  // Per-IP rate limit
  const clientIp = getClientIp(req);
  const ipCheck = await checkIpReadLimit(clientIp);
  if (!ipCheck.ok) {
    console.warn('[magic-link-request] IP rate limited', { ipHash: piiHash(clientIp) });
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

  // Generate one-time token + store in Redis with 15-minute TTL.
  const token = crypto.randomBytes(16).toString('hex');
  const redisKey = 'magiclink:' + token;
  try {
    await redis.set(redisKey, normEmail, 'EX', 15 * 60);
  } catch (e) {
    console.error('[magic-link-request] redis SET failed:', e.message);
    return res.status(500).json({ ok: false, error: 'storage_failed' });
  }

  const signinUrl =
    'https://www.mygrindapp.com/signin.html?mode=magicLink&token=' + token;

  const from        = process.env.RESEND_FROM || 'MyGrind <coach@mygrindapp.com>';
  const testRedirect = process.env.WEEKLY_DIGEST_TEST_EMAIL || '';
  const to          = testRedirect || normEmail;

  const { html, text } = buildEmailHtml({ signinUrl, email: normEmail });

  try {
    const resend = new Resend(resendKey);
    const result = await resend.emails.send({
      from,
      to,
      subject: 'Your MyGrind sign-in link',
      html,
      text,
      replyTo: 'coach@mygrindapp.com',
    });
    console.log('[magic-link-request] sent', {
      toHash:      piiHash(to),
      redirected:  !!testRedirect,
      resendId:    result?.data?.id || null,
      tokenPrefix: token.slice(0, 6),
    });
  } catch (e) {
    console.error('[magic-link-request] send failed:', e.message);
    // Token is still in Redis — best to let it expire vs. proactively
    // delete (gives Resend a retry window if Coach's logs show it).
    return res.status(500).json({ ok: false, error: 'send_failed' });
  }

  // Same response shape regardless of whether the email is "real" — we
  // never confirm or deny that an email is on file, so this endpoint
  // can't be used to enumerate which addresses have accounts.
  return res.status(200).json({ ok: true });
}
