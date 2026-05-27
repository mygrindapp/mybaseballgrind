// ═══════════════════════════════════════════════════════════
// MyGrind — api/admin/founder-count.js
// ───────────────────────────────────────────────────────────
// COACH-ONLY endpoint. Returns the live count of founder-cohort
// signups for each tracked promo code (FOUNDERMYGRIND and
// FOREVERYOUNG2026). Reads the Redis Sets populated by
// /api/start-trial when a user signs up with one of those codes.
//
// Usage:
//   GET /api/admin/founder-count?token=ADMIN_RESCUE_TOKEN
//   GET /api/admin/founder-count?token=...&list=FOUNDERMYGRIND   (dump emails)
//   POST /api/admin/founder-count                                 (backfill)
//       body: { token, code, emails: ["a@b.com", ...] }
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
  // Token can come from query (?token=...) or POST body.
  const tokenFromQuery = req.query && req.query.token;
  const tokenFromBody  = req.body && req.body.token;
  const token = tokenFromQuery || tokenFromBody;

  if (!authenticate(token)) {
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
