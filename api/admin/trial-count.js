// ═══════════════════════════════════════════════════════════
// MyGrind — api/admin/trial-count.js
// ───────────────────────────────────────────────────────────
// COACH-ONLY, READ-ONLY endpoint. Returns the true count of
// no-card / free-trial starts recorded in Redis (the trial:email:*
// keys written by /api/start-trial).
//
// WHY IT EXISTS: a no-card trial writes trial:email:<x> but only
// creates a Firebase Auth identity if the user later enters the
// emailed sign-in code. A trial-starter who never enters the code
// is invisible in BOTH the Firebase Auth dashboard AND Stripe. This
// endpoint is the only way to see the real "free side" headcount,
// including those invisible starters. Sibling of founder-count.js.
//
// Usage (the admin token goes in a HEADER, never the URL):
//   GET  /api/admin/trial-count
//        -H "Authorization: Bearer $ADMIN_RESCUE_TOKEN"
//        → { ok, count, converted, active }
//   GET  /api/admin/trial-count?list=1                (dump emails — PII)
//        -H "Authorization: Bearer $ADMIN_RESCUE_TOKEN"
//        → { ok, count, converted, active, trials: [{email,recordedAt,source,hasSub}] }
//
// Response shape (default GET):
//   200 { ok: true, count: N, converted: C, active: A }
//     count     = total trial:email records ever written
//     converted = those that now also have a sub:<email> (became paid)
//     active    = count - converted (still on a no-card / unpaid trial)
//
// SECURITY (identical posture to founder-count.js):
//   - Requires ADMIN_RESCUE_TOKEN env var (same token as founder-count).
//   - Constant-time compare to defeat timing attacks.
//   - IP rate-limit BEFORE the token compare so probes burn the budget.
//   - ?list=1 can return PII (emails) — only fire when needed, never log.
//   - Read-only: no writes, no deletes, no funnel/money-path impact.
// ═══════════════════════════════════════════════════════════

import crypto from 'crypto';
import { listAllTrials } from '../../lib/trial-eligibility-store.js';
import { checkIpReadLimit, recordRead } from '../../lib/rate-limit.js';

function constantTimeEqual(a, b) {
  const ab = Buffer.from(a || '', 'utf8');
  const bb = Buffer.from(b || '', 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function authenticate(token) {
  const expected = process.env.ADMIN_RESCUE_TOKEN;
  if (!expected || expected.length < 32) return false;
  return constantTimeEqual(String(token || ''), expected);
}

// Read the admin token from headers only (never query/body). Query-string
// tokens leak into access/proxy logs, browser history, and Referer headers.
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

export default async function handler(req, res) {
  // Throttle by IP BEFORE the token compare so unauthenticated probes burn
  // the budget (defense-in-depth behind the constant-time check). On the
  // right token + ?list=1 this endpoint dumps PII (emails), so cap brute
  // force per IP. Reuses the shared read limiter; fails open on a Redis blip.
  const clientIp = getClientIp(req);
  const ipCheck = await checkIpReadLimit(clientIp);
  if (!ipCheck.ok) {
    console.warn('[admin/trial-count] rate limited', { ip: clientIp || 'unknown', reason: ipCheck.reason });
    return res.status(429).json({ ok: false, error: 'rate_limited' });
  }
  await recordRead(clientIp);

  const token = getAdminToken(req);
  if (!authenticate(token)) {
    console.warn('[admin/trial-count] auth failed', { ip: clientIp || 'unknown', tokenLen: String(token || '').length });
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const result = await listAllTrials();
  if (!result.ok) {
    return res.status(500).json(result);
  }

  // Default GET: counts only (no PII). ?list=1 adds the email records.
  const wantList = req.query && (req.query.list === '1' || req.query.list === 'true');
  const body = {
    ok:        true,
    count:     result.count,
    converted: result.converted,
    active:    result.active,
  };
  if (wantList) body.trials = result.trials;
  return res.status(200).json(body);
}
