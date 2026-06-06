// ═══════════════════════════════════════════════════════════
// MyGrind — api/admin/signin-link.js (Coach rescue endpoint)
// ───────────────────────────────────────────────────────────
// COACH-ONLY endpoint. Generates a working sign-in link for any
// email, bypassing email delivery entirely. Use when a customer
// can't receive their Firebase magic-link email (spam folder,
// school-domain blocks, typo at signup, lost email access).
//
// Flow:
//   1. Coach calls it with the admin token in a HEADER (not the URL):
//      curl "https://www.mygrindapp.com/api/admin/signin-link?email=X" \
//           -H "Authorization: Bearer $ADMIN_RESCUE_TOKEN"
//   2. Endpoint validates the admin token (constant-time compare).
//   3. Endpoint generates a single-use sign-in token, stores in
//      Redis under the same `magiclink:<token>` key the normal
//      magic-link-verify endpoint reads — 24-hour TTL.
//   4. Returns JSON: { ok, signinUrl, email, expiresIn, expiresAt }
//   5. Coach pastes signinUrl into iMessage / email / direct DM
//      to the stuck customer.
//   6. Customer taps the link, signin.html (mode=magicLink) reads
//      Redis via magic-link-verify, mints a custom token, signs
//      them in. Firebase Auth user is created on first successful
//      sign-in.
//
// SECURITY:
//   - Requires ADMIN_RESCUE_TOKEN env var (32+ chars). Anything
//     less, the endpoint refuses to run.
//   - Constant-time compare to defeat timing attacks.
//   - Token validation happens BEFORE Redis or any other work so
//     unauthenticated probes can't burn resources.
//   - Hashed email in logs (PII-safe).
//
// Env vars required:
//   - ADMIN_RESCUE_TOKEN (Sensitive, Production/Preview/Development)
//   - REDIS_URL (already present)
// ═══════════════════════════════════════════════════════════

import crypto from 'crypto';
import Redis from 'ioredis';
import { checkIpReadLimit, recordRead } from '../../lib/rate-limit.js';

const RESCUE_TTL_SECONDS = 24 * 60 * 60;

let _redis = null;
function getRedis() {
  if (_redis) return _redis;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  _redis = new Redis(url, { maxRetriesPerRequest: 2, enableReadyCheck: false });
  _redis.on('error', (e) => console.error('[admin/signin-link] redis:', e.message));
  return _redis;
}

function constantTimeEqual(a, b) {
  const ab = Buffer.from(a || '', 'utf8');
  const bb = Buffer.from(b || '', 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// Read the admin token from headers only (never query/body — see handler).
function getAdminToken(req) {
  const auth = req.headers['authorization'] || '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  const x = req.headers['x-admin-token'];
  return (Array.isArray(x) ? x[0] : x) || '';
}

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.headers['x-real-ip'] || null;
}

function piiHash(s) {
  return crypto.createHash('sha256').update(String(s || '')).digest('hex').slice(0, 12);
}

function isValidEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const expected = process.env.ADMIN_RESCUE_TOKEN;
  if (!expected || expected.length < 32) {
    console.error('[admin/signin-link] ADMIN_RESCUE_TOKEN missing or too short');
    return res.status(500).json({ ok: false, error: 'server_misconfigured' });
  }

  // Throttle by IP BEFORE the token compare so unauthenticated probes burn the
  // budget (defense-in-depth behind the constant-time check). This endpoint can
  // mint a 24h sign-in link for ANY account, so the token is high-value — cap
  // brute-force volume per IP. Reuses the shared read limiter (60/hr, 600/day),
  // which fails open on a Redis blip so an outage can't lock admin out.
  const clientIp = getClientIp(req);
  const ipCheck = await checkIpReadLimit(clientIp);
  if (!ipCheck.ok) {
    console.warn('[admin/signin-link] rate limited', { ip: clientIp || 'unknown', reason: ipCheck.reason });
    return res.status(429).json({ ok: false, error: 'rate_limited' });
  }
  await recordRead(clientIp);

  // Admin token comes from a request HEADER only — never the query string.
  // A query-string token leaks into access/proxy logs, browser history, and
  // Referer headers, and this token can mint a sign-in link for ANY account.
  // Accept `Authorization: Bearer <token>` or `X-Admin-Token: <token>`.
  const provided = getAdminToken(req);
  if (!constantTimeEqual(provided, expected)) {
    console.warn('[admin/signin-link] auth failed', {
      ip:       req.headers['x-forwarded-for'] || 'unknown',
      tokenLen: provided.length,
    });
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  const rawEmail = String(req.query.email || '').trim().toLowerCase();
  if (!rawEmail) {
    return res.status(400).json({ ok: false, error: 'missing_email' });
  }
  if (!isValidEmail(rawEmail)) {
    return res.status(400).json({ ok: false, error: 'invalid_email' });
  }

  const redis = getRedis();
  if (!redis) {
    console.error('[admin/signin-link] redis unavailable');
    return res.status(500).json({ ok: false, error: 'storage_unavailable' });
  }

  const token = crypto.randomBytes(16).toString('hex');
  const redisKey = 'magiclink:' + token;
  try {
    await redis.set(redisKey, rawEmail, 'EX', RESCUE_TTL_SECONDS);
  } catch (e) {
    console.error('[admin/signin-link] redis SET failed:', e.message);
    return res.status(500).json({ ok: false, error: 'storage_failed' });
  }

  const signinUrl =
    'https://www.mygrindapp.com/signin.html?mode=magicLink&token=' + token;

  console.log('[admin/signin-link] generated rescue link', {
    emailHash:   piiHash(rawEmail),
    tokenPrefix: token.slice(0, 6),
    expiresIn:   RESCUE_TTL_SECONDS,
    ts:          new Date().toISOString(),
  });

  return res.status(200).json({
    ok:        true,
    signinUrl,
    email:     rawEmail,
    expiresIn: RESCUE_TTL_SECONDS,
    expiresAt: new Date(Date.now() + RESCUE_TTL_SECONDS * 1000).toISOString(),
  });
}
