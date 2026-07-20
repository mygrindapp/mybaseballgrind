// ═══════════════════════════════════════════════════════════
// MyGrind — api/auth/verify-code.js (consumes 6-digit code)
// ───────────────────────────────────────────────────────────
// Companion to api/auth/request-code.js. When the user types
// the 6-digit code from their email into the sign-in screen,
// signin.html POSTs { email, code } here. We look up the stored
// hash in Redis, constant-time compare, delete on match, mint a
// Firebase custom token, and return it. Client signs in via
// firebase.auth().signInWithCustomToken(...).
//
// UID derivation is delegated to lib/firebase-admin.js so this
// path lands users in the SAME Firebase Auth account they would
// get via the magic-link path. Critical: do not fork accounts.
//
// Endpoint: POST /api/auth/verify-code
// Body:    { email, code }
// Response:
//   200 { ok: true, customToken, email, uid }
//   400 { ok: false, error: 'missing_email' | 'missing_code' | 'invalid_email' | 'invalid_code_format' }
//   401 { ok: false, error: 'invalid_code' }  ← single error for wrong / expired / over-attempts
//   429 { ok: false, error: 'rate_limited' }
//   500 { ok: false, error: 'server_misconfigured' | 'admin_not_configured' | 'mint_failed' | 'storage_failed' }
//
// Security:
//   - Stored value is sha256(code); we compare hashes with
//     crypto.timingSafeEqual so wall-clock side channels do not
//     leak which digit was off.
//   - On successful match the code key is DEL'd so a second
//     submission of the same code fails (single-use).
//   - Per-email attempt counter caps brute-force at 5 tries per
//     code period. 6-digit space is 1M; 5 attempts = 0.0005%
//     guess probability per cycle. Counter shares TTL with code.
//   - Per-IP rate limit defends against distributed guessing
//     from many emails.
// ═══════════════════════════════════════════════════════════

import crypto from 'crypto';
import Redis from 'ioredis';
import { checkIpReadLimit, recordRead } from '../../lib/rate-limit.js';
import { mintCustomTokenForEmail } from '../../lib/firebase-admin.js';

const ALLOWED_ORIGINS = new Set([
  'https://www.mygrindapp.com',
  'https://mygrindapp.com',
]);

const ATTEMPT_TTL_SECONDS = 15 * 60;
const ATTEMPT_MAX = 5;

let _redis = null;
function getRedis() {
  if (_redis) return _redis;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  _redis = new Redis(url, { maxRetriesPerRequest: 2, enableReadyCheck: false });
  _redis.on('error', (e) => console.error('[auth/verify-code] redis:', e.message));
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

function constantTimeEqualHex(a, b) {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const redis = getRedis();
  if (!redis) {
    console.error('[auth/verify-code] REDIS_URL not set');
    return res.status(500).json({ ok: false, error: 'server_misconfigured' });
  }

  const clientIp = getClientIp(req);
  const ipCheck = await checkIpReadLimit(clientIp);
  if (!ipCheck.ok) {
    console.warn('[auth/verify-code] IP rate limited', { ipHash: piiHash(clientIp) });
    return res.status(429).json({ ok: false, error: 'rate_limited' });
  }
  await recordRead(clientIp);

  const { email, code } = req.body || {};
  if (!email) return res.status(400).json({ ok: false, error: 'missing_email' });
  if (!code)  return res.status(400).json({ ok: false, error: 'missing_code' });

  const normEmail = String(email).trim().toLowerCase();
  if (!isValidEmail(normEmail)) {
    return res.status(400).json({ ok: false, error: 'invalid_email' });
  }
  const trimmedCode = String(code).replace(/\s+/g, '');
  if (!/^\d{6}$/.test(trimmedCode)) {
    return res.status(400).json({ ok: false, error: 'invalid_code_format' });
  }

  const emailHash = emailKeyHash(normEmail);
  const codeKey    = 'signincode:'      + emailHash;
  const attemptKey = 'signincode-att:'  + emailHash;

  // Bump the attempt counter BEFORE reading the stored hash so an attacker
  // who never sends a valid code still burns through their cap.
  let attempts = 0;
  try {
    attempts = await redis.incr(attemptKey);
    if (attempts === 1) {
      await redis.expire(attemptKey, ATTEMPT_TTL_SECONDS);
    }
  } catch (e) {
    console.error('[auth/verify-code] redis attempt INCR failed:', e.message);
    return res.status(500).json({ ok: false, error: 'storage_failed' });
  }
  if (attempts > ATTEMPT_MAX) {
    return res.status(401).json({ ok: false, error: 'invalid_code' });
  }

  let stored = null;
  try {
    stored = await redis.get(codeKey);
  } catch (e) {
    console.error('[auth/verify-code] redis GET failed:', e.message);
    return res.status(500).json({ ok: false, error: 'storage_failed' });
  }
  if (!stored) {
    return res.status(401).json({ ok: false, error: 'invalid_code' });
  }

  const providedHash = sha256Hex(trimmedCode);
  if (!constantTimeEqualHex(providedHash, stored)) {
    return res.status(401).json({ ok: false, error: 'invalid_code' });
  }

  try {
    await redis.del(codeKey);
    await redis.del(attemptKey);
  } catch (e) {
    console.error('[auth/verify-code] redis DEL failed:', e.message);
    // Token compare already succeeded; sign the user in regardless. The
    // code key has a 15-min TTL so even if DEL flaked the worst case is a
    // short replay window for the same already-authenticated user.
  }

  const mint = await mintCustomTokenForEmail(normEmail);
  if (!mint.ok) {
    console.error('[auth/verify-code] mint failed:', { emailHash: piiHash(normEmail), reason: mint.error });
    if (mint.error === 'admin_not_configured') {
      return res.status(500).json({ ok: false, error: 'admin_not_configured' });
    }
    return res.status(500).json({ ok: false, error: 'mint_failed' });
  }

  console.log('[auth/verify-code] signed in', {
    emailHash:  piiHash(normEmail),
    uid:        mint.uid,
    newAccount: !!mint.created,
  });

  return res.status(200).json({
    ok:          true,
    customToken: mint.customToken,
    email:       mint.email,
    uid:         mint.uid,
    newAccount:  !!mint.created,
  });
}
