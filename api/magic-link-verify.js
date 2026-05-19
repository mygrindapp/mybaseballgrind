// ═══════════════════════════════════════════════════════════
// MyGrind — api/magic-link-verify.js (consumes the link token)
// ───────────────────────────────────────────────────────────
// Companion to api/magic-link-request.js. When the user taps the
// "Sign In to MyGrind →" button in the email, signin.html POSTs the
// token here. We look it up in Redis, delete it (one-time use), and
// return a Firebase custom token + the user's email. The client uses
// firebase.auth().signInWithCustomToken(...) to complete the sign-in.
//
// Endpoint: POST /api/magic-link-verify
// Body:    { token }
// Response:
//   200 { ok: true, customToken, email, uid } — sign in client-side
//   400 { ok: false, error: 'missing_token' }
//   401 { ok: false, error: 'invalid_or_expired_token' }
//   429 { ok: false, error: 'rate_limited' }
//   500 { ok: false, error: 'server_misconfigured' | 'admin_not_configured' | 'mint_failed' }
//
// Security:
//   - Token is GETDEL'd from Redis (atomic) so concurrent re-use returns
//     invalid_token to the second caller.
//   - Per-IP rate limit defends against token brute-force (token space
//     is 2^128 already, but rate limit is belt-and-suspenders).
//   - Admin SDK is lazy-imported via lib/firebase-admin.js; if the
//     service account env var isn't set, returns admin_not_configured
//     so the client can fall back to Firebase's built-in email-link.
// ═══════════════════════════════════════════════════════════

import crypto from 'crypto';
import Redis from 'ioredis';
import { checkIpReadLimit, recordRead } from '../lib/rate-limit.js';
import { mintCustomTokenForEmail } from '../lib/firebase-admin.js';

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
  _redis.on('error', (e) => console.error('[magic-link-verify] redis:', e.message));
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

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const redis = getRedis();
  if (!redis) {
    console.error('[magic-link-verify] REDIS_URL not set');
    return res.status(500).json({ ok: false, error: 'server_misconfigured' });
  }

  // Per-IP rate limit
  const clientIp = getClientIp(req);
  const ipCheck = await checkIpReadLimit(clientIp);
  if (!ipCheck.ok) {
    console.warn('[magic-link-verify] IP rate limited', { ipHash: piiHash(clientIp) });
    return res.status(429).json({ ok: false, error: 'rate_limited' });
  }
  await recordRead(clientIp);

  const { token } = req.body || {};
  if (!token || typeof token !== 'string' || token.length !== 32 || !/^[a-f0-9]+$/.test(token)) {
    return res.status(400).json({ ok: false, error: 'missing_token' });
  }

  // GETDEL — atomic read + delete so a second tap of the same link can't
  // sign anyone in. Available in Redis 6.2+; ioredis exposes it.
  const redisKey = 'magiclink:' + token;
  let email = null;
  try {
    if (typeof redis.getdel === 'function') {
      email = await redis.getdel(redisKey);
    } else {
      // Fallback for older Redis: GET then DEL. Race window is tiny
      // (millis on the same Redis connection); acceptable in practice.
      email = await redis.get(redisKey);
      if (email) await redis.del(redisKey);
    }
  } catch (e) {
    console.error('[magic-link-verify] redis GETDEL failed:', e.message);
    return res.status(500).json({ ok: false, error: 'storage_failed' });
  }

  if (!email) {
    return res.status(401).json({ ok: false, error: 'invalid_or_expired_token' });
  }

  const mint = await mintCustomTokenForEmail(email);
  if (!mint.ok) {
    console.error('[magic-link-verify] mint failed:', { emailHash: piiHash(email), reason: mint.error });
    if (mint.error === 'admin_not_configured') {
      return res.status(500).json({ ok: false, error: 'admin_not_configured' });
    }
    return res.status(500).json({ ok: false, error: 'mint_failed' });
  }

  console.log('[magic-link-verify] signed in', {
    emailHash:   piiHash(email),
    tokenPrefix: token.slice(0, 6),
    uid:         mint.uid,
  });

  return res.status(200).json({
    ok:          true,
    customToken: mint.customToken,
    email:       mint.email,
    uid:         mint.uid,
  });
}
