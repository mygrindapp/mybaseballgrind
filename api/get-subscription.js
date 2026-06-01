// ═══════════════════════════════════════════════════════════
// MyGrind — api/get-subscription.js (Phase 5 Step 4)
// ───────────────────────────────────────────────────────────
// Returns the subscription status for a given email so client-side
// surfaces (softball.html paywall, signup.html dashboard) can decide
// whether to gate paid features.
//
// Auth (2026-05-29): scoped to the email's owner via a Firebase ID token
// (Authorization: Bearer <id-token>) — the token's email must match the
// requested email. Staged behind ACCESS_TOKEN_ENFORCE (see lib/access.js):
// Phase 1 accepts token-less callers (but rejects mismatched tokens); Phase 2
// requires a matching token. The PII-stripped read + per-IP cap below remain
// as defense-in-depth.
// ═══════════════════════════════════════════════════════════

import crypto from 'crypto';
import { getSubscription } from '../lib/subscription-store.js';
import { checkIpReadLimit, recordRead } from '../lib/rate-limit.js';
import { authorizeEmailOwner } from '../lib/access.js';

const ALLOWED_ORIGINS = new Set([
  'https://www.mygrindapp.com',
  'https://mygrindapp.com',
]);

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers['x-real-ip'] || null;
}

function piiHash(value) {
  if (!value) return 'none';
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 8);
}

function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')     return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const email = (req.query.email || '').toString();
  if (!email) return res.status(400).json({ ok: false, error: 'missing_email' });

  // ─── Owner check (Firebase ID token, staged) ─────────────────
  const access = await authorizeEmailOwner(req, email);
  if (!access.ok) return res.status(access.status).json({ ok: false, error: access.error });

  // ─── Rate limit (defense-in-depth) ───────────────────────────
  // The owner check above already gates this endpoint to the email's owner.
  // The per-IP read cap stays as a second layer — it blunts bulk-enumeration
  // probes and matches the other read endpoints. Fail-open on Redis outage,
  // matching the rest of the infra.
  const clientIp = getClientIp(req);
  const ipCheck = await checkIpReadLimit(clientIp);
  if (!ipCheck.ok) {
    console.warn('[get-subscription] IP rate limited', { ipHash: piiHash(clientIp), reason: ipCheck.reason });
    return res.status(429).json({ ok: false, error: 'rate_limited' });
  }
  await recordRead(clientIp);

  const result = await getSubscription(email);
  if (!result.ok) return res.status(500).json(result);

  // Don't echo the customerId / subscriptionId to the client — they're
  // internal identifiers. Just send the boolean flag + plan + period end.
  // hasCardOnFile is exposed so softball.html's Option A banner can suppress
  // the Day-11 "Lock In Your Card" CTA for users who already captured.
  const safe = result.record ? {
    isPaid:           result.isPaid,
    status:           result.record.status,
    plan:             result.record.plan,
    currentPeriodEnd: result.record.currentPeriodEnd,
    cancelAtPeriodEnd:result.record.cancelAtPeriodEnd,
    hasCardOnFile:    !!result.record.hasCardOnFile,
  } : null;

  return res.status(200).json({ ok: true, isPaid: result.isPaid, hasCardOnFile: !!(result.record && result.record.hasCardOnFile), subscription: safe });
}
