// ═══════════════════════════════════════════════════════════
// MyGrind — api/push-subscribe.js  (Web Push daily reminder, Phase B)
// ───────────────────────────────────────────────────────────
// POST   → store a Web Push subscription   { subscription, tz, hour, email? }
// DELETE → remove one                        { endpoint }  (or { subscription })
//
// No auth required by design: most players are local-only (no account), and the
// push subscription itself is the credential to reach that device. Email is
// optional metadata. The send step lives in api/cron/daily-reminder.js (Phase C),
// gated behind PUSH_DRY_RUN until verified on a real device.
//
// 2026-07-02 hardening (audit M2): per-IP rate limit (read tier, 60/hr,
// 600/day) — this was the last unauthenticated endpoint with no limiter, so
// anyone could flood Firestore with junk subscription docs (write-
// amplification / cost DoS). Same fail-open-on-Redis-blip behavior as every
// other public endpoint.
// ═══════════════════════════════════════════════════════════

import { savePushSubscription, deletePushSubscription } from '../lib/push-store.js';
import { checkIpReadLimit, recordRead } from '../lib/rate-limit.js';

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers['x-real-ip'] || null;
}

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
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (e) { return {}; }
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Per-IP limit on both POST and DELETE (see header comment).
  const clientIp = getClientIp(req);
  const ipCheck = await checkIpReadLimit(clientIp);
  if (!ipCheck.ok) {
    return res.status(429).json({ ok: false, error: 'rate_limited' });
  }
  await recordRead(clientIp);

  const body = readBody(req);

  if (req.method === 'POST') {
    const sub = body.subscription;
    if (!sub || !sub.endpoint || !sub.keys) {
      return res.status(400).json({ ok: false, error: 'invalid_subscription' });
    }
    const result = await savePushSubscription({
      subscription: sub,
      tz: body.tz,
      hour: typeof body.hour === 'number' ? body.hour : undefined,
      email: body.email || null,
    });
    return res.status(result.ok ? 200 : 500).json(result);
  }

  if (req.method === 'DELETE') {
    const endpoint = body.endpoint || (body.subscription && body.subscription.endpoint);
    if (!endpoint) return res.status(400).json({ ok: false, error: 'missing_endpoint' });
    const result = await deletePushSubscription(endpoint);
    return res.status(result.ok ? 200 : 500).json(result);
  }

  return res.status(405).json({ ok: false, error: 'method_not_allowed' });
}
