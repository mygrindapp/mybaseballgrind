// ═══════════════════════════════════════════════════════════
// MyGrind — api/admin/founder-count.js
// ───────────────────────────────────────────────────────────
// COACH-ONLY endpoint. Returns the live count of founder-cohort
// signups for each tracked promo code (FOUNDERMYGRIND and
// FOREVERYOUNG2026). Reads the Redis Sets populated by
// /api/start-trial when a user signs up with one of those codes.
//
// Usage (the admin token goes in a HEADER, never the URL):
//   GET  /api/admin/founder-count
//        -H "Authorization: Bearer $ADMIN_RESCUE_TOKEN"
//   GET  /api/admin/founder-count?list=FOUNDERMYGRIND   (dump emails)
//        -H "Authorization: Bearer $ADMIN_RESCUE_TOKEN"
//   POST /api/admin/founder-count                       (backfill)
//        -H "Authorization: Bearer $ADMIN_RESCUE_TOKEN"
//        body: { code, emails: ["a@b.com", ...] }
//
// Response shape (default GET):
//   200 { ok: true, counts: { FOUNDERMYGRIND: N, FOREVERYOUNG2026: M },
//         caps: { FOUNDERMYGRIND: 100, FOREVERYOUNG2026: 10 } }
//
// SECURITY:
//   - Requires ADMIN_RESCUE_TOKEN env var (same token as signin-link.js).
//   - Constant-time compare to defeat timing attacks.
//   - Token validation BEFORE any Redis work so probes can't burn
//     resources.
//   - When dumping emails, the response can contain PII — only fire
//     when actually needed, never log the full list.
// ═══════════════════════════════════════════════════════════

import crypto from 'crypto';
import Redis from 'ioredis';
import {
  getAllFounderCounts,
  backfillFounders,
} from '../../lib/founder-cohort-store.js';
import { checkIpReadLimit, recordRead } from '../../lib/rate-limit.js';

const CAPS = {
  FOUNDERMYGRIND:   100,
  FOREVERYOUNG2026: 10,
};

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

let _redis = null;
function getRedis() {
  if (_redis) return _redis;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  _redis = new Redis(url, { maxRetriesPerRequest: 2, enableReadyCheck: false });
  _redis.on('error', (e) => console.error('[admin/founder-count] redis:', e.message));
  return _redis;
}

export default async function handler(req, res) {
  // Admin token comes from a request HEADER only — never the query string
  // or body. Query-string tokens leak into access/proxy logs, browser
  // history, and Referer headers; this token is high-value (same one that
  // mints sign-in links), so it must not travel in a URL. Accept either
  // `Authorization: Bearer <token>` or `X-Admin-Token: <token>`.
  // Throttle by IP BEFORE the token compare so unauthenticated probes burn the
  // budget (defense-in-depth behind the constant-time check). On the right
  // token this endpoint dumps founder PII (emails), so cap brute-force volume
  // per IP. Reuses the shared read limiter (60/hr, 600/day); fails open on a
  // Redis blip so an outage can't lock admin out.
  const clientIp = getClientIp(req);
  const ipCheck = await checkIpReadLimit(clientIp);
  if (!ipCheck.ok) {
    console.warn('[admin/founder-count] rate limited', { ip: clientIp || 'unknown', reason: ipCheck.reason });
    return res.status(429).json({ ok: false, error: 'rate_limited' });
  }
  await recordRead(clientIp);

  const token = getAdminToken(req);

  if (!authenticate(token)) {
    // Previously unlogged — log auth failures so repeated 401s are visible.
    console.warn('[admin/founder-count] auth failed', { ip: clientIp || 'unknown', tokenLen: String(token || '').length });
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  // ─── POST: backfill ────────────────────────────────────────
  if (req.method === 'POST') {
    const { code, emails } = req.body || {};
    if (!code || !Array.isArray(emails)) {
      return res.status(400).json({ ok: false, error: 'missing_code_or_emails' });
    }
    const result = await backfillFounders({ code, emails });
    if (!result.ok) return res.status(400).json(result);
    return res.status(200).json(result);
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  // ─── GET ?list=CODE — dump emails ──────────────────────────
  const listCode = req.query && req.query.list;
  if (listCode) {
    const code = String(listCode).trim().toUpperCase();
    if (!CAPS[code]) {
      return res.status(400).json({ ok: false, error: 'unknown_code' });
    }
    const r = getRedis();
    if (!r) return res.status(500).json({ ok: false, error: 'redis_unavailable' });
    try {
      const emails = await r.smembers('founder:set:' + code);
      return res.status(200).json({
        ok:    true,
        code,
        count: emails.length,
        cap:   CAPS[code],
        emails,
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // ─── GET (default) — counts only ───────────────────────────
  const result = await getAllFounderCounts();
  if (!result.ok) {
    return res.status(500).json(result);
  }
  return res.status(200).json({
    ok:     true,
    counts: result.counts,
    caps:   CAPS,
    remaining: {
      FOUNDERMYGRIND:   Math.max(0, CAPS.FOUNDERMYGRIND   - (result.counts.FOUNDERMYGRIND   || 0)),
      FOREVERYOUNG2026: Math.max(0, CAPS.FOREVERYOUNG2026 - (result.counts.FOREVERYOUNG2026 || 0)),
    },
  });
}
