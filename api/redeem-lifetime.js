// ═══════════════════════════════════════════════════════════
// MyGrind — api/redeem-lifetime.js (2026-06-07 audit #4)
// ───────────────────────────────────────────────────────────
// Server-side redemption for the FOREVERYOUNG2026 lifetime comp.
//
// Before this endpoint, "free for life" was granted entirely client-
// side: signup.html/softball.html wrote { paid:true, plan:'lifetime' }
// to localStorage on a plaintext string match of the code. That meant
// (a) the 10-cap was marketing fiction — never enforced — and (b)
// anyone who typed the (publicly-shipped) code, or set the localStorage
// flag in DevTools, got free-forever access with no server record to
// audit or revoke.
//
// This endpoint makes the grant server-authoritative:
//   1. Atomically claim a capped slot in founder:set:FOREVERYOUNG2026
//      (redeemFounderSlot enforces the 10-cap; idempotent for re-redeems
//      / backfills — a returning email never consumes a fresh slot).
//   2. On success, write a sub:<email> record { status:'active',
//      plan:'lifetime', currentPeriodEnd:null } so /api/get-subscription
//      reports isPaid:true forever. softball.html's syncSubscriptionFromServer
//      then treats the server as the source of truth.
//   3. If the cap is already full → 409 cap_reached and NO grant; the
//      client falls back to the normal 14-day trial.
//
// BACKFILL: an existing comp (granted before this endpoint) can be made
// server-backed by POSTing their email here once — it's idempotent, so it
// writes the sub record without consuming a slot they already hold.
//
// Response shape:
//   200 { ok: true, plan: 'lifetime', remaining }
//   409 { ok: false, error: 'cap_reached' }
//   400 { ok: false, error: 'missing_email' | 'invalid_email' | 'bad_code' }
//   429 { ok: false, error: 'rate_limited' }
// ═══════════════════════════════════════════════════════════

import crypto from 'crypto';
import { redeemFounderSlot } from '../lib/founder-cohort-store.js';
import { grantLifetime } from '../lib/subscription-store.js';
import { checkIpReadLimit, recordRead } from '../lib/rate-limit.js';

// Only the lifetime code is redeemable here. FOUNDERMYGRIND is a 180-day
// trial, not a lifetime grant, so it does not flow through this endpoint.
const LIFETIME_CODE = 'FOREVERYOUNG2026';
const LIFETIME_CAP  = 10;

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

function isValidEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const body = req.body || {};
  const email = String(body.email || '').trim().toLowerCase();
  const code  = String(body.promoCode || '').trim().toUpperCase();

  if (!email)            return res.status(400).json({ ok: false, error: 'missing_email' });
  if (!isValidEmail(email)) return res.status(400).json({ ok: false, error: 'invalid_email' });
  if (code !== LIFETIME_CODE) return res.status(400).json({ ok: false, error: 'bad_code' });

  // ─── Read-tier rate limit (same limiter as start-trial) ───
  const clientIp = getClientIp(req);
  const ipCheck = await checkIpReadLimit(clientIp);
  if (!ipCheck.ok) {
    console.warn('[redeem-lifetime] IP rate limited', { ipHash: piiHash(clientIp), reason: ipCheck.reason });
    return res.status(429).json({ ok: false, error: 'rate_limited' });
  }
  await recordRead(clientIp);

  // ─── Atomically claim a capped slot ───────────────────────
  const slot = await redeemFounderSlot({ email, promoCode: LIFETIME_CODE });
  if (!slot.ok) {
    console.error('[redeem-lifetime] slot claim failed', { emailHash: piiHash(email), error: slot.error });
    return res.status(500).json({ ok: false, error: 'redeem_failed' });
  }
  if (slot.capReached) {
    console.warn('[redeem-lifetime] cap reached', { emailHash: piiHash(email), count: slot.count });
    return res.status(409).json({ ok: false, error: 'cap_reached' });
  }

  // ─── Slot confirmed → write the server-side lifetime record ──
  const grant = await grantLifetime(email, 'foreveryoung2026');
  if (!grant.ok) {
    console.error('[redeem-lifetime] grant write failed', { emailHash: piiHash(email), error: grant.error });
    return res.status(500).json({ ok: false, error: 'grant_failed' });
  }

  console.log('[redeem-lifetime] lifetime granted', {
    emailHash: piiHash(email),
    isNew:     slot.isNew,
    count:     slot.count,
    ts:        new Date().toISOString(),
  });

  return res.status(200).json({
    ok:        true,
    plan:      'lifetime',
    remaining: Math.max(0, LIFETIME_CAP - (slot.count || 0)),
  });
}
