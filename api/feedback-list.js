// ═══════════════════════════════════════════════════════════
// Phase 7b — Lists feedback request/response records for the
// signed-in account (by parent email). Drives the "New from
// Coach" card on softball.html and the "This Week's Coaching"
// card on signup.html Screen 8.
//
// Security (2026-06-05 audit fix #4): reads are OWNER-SCOPED.
// The query is by parent email and gated through lib/access.js —
// the Authorization: Bearer Firebase ID token's email must match
// the requested email. The old unauthenticated ?player=<phone>
// read path was REMOVED: it let anyone who knew or guessed a
// player's phone pull that minor's coaching content and the
// coach's name + phone with no token. (Writes were already token-
// gated by the per-request magic-link token in feedback-store.js.)
// ═══════════════════════════════════════════════════════════

import crypto from 'crypto';
import { listForParent } from '../lib/feedback-store.js';
import { checkIpReadLimit, recordRead } from '../lib/rate-limit.js';
import { authorizeEmailOwner } from '../lib/access.js';

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
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
  if (req.method !== 'GET')     return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const parentEmail = (req.query.parent || '').toString();
  const days        = Math.max(1, Math.min(90, parseInt(req.query.days || '30', 10) || 30));

  // Reads are owner-scoped to the account email only. The legacy ?player=<phone>
  // path was an unauthenticated enumeration surface (anyone who knew a phone got
  // a minor's coaching content + the coach's name/phone) and has been removed —
  // both dashboard cards (softball.html, signup.html) query by the signed-in
  // account's email. A bare phone query is no longer accepted.
  if (!parentEmail) {
    return res.status(400).json({ ok: false, error: 'parent_required', items: [] });
  }

  // ─── Owner check (Firebase ID token; lib/access.js) ──────────────────────
  // The query returns a household's coaching history, so we scope it to the
  // email's owner: the Bearer token's email must match the requested email.
  const access = await authorizeEmailOwner(req, parentEmail);
  if (!access.ok) return res.status(access.status).json({ ok: false, error: access.error, items: [] });

  // ─── Rate limit (secondary — the owner token above is the real gate) ──
  // checkIpReadLimit caps a single IP at 60/hr, 600/day (lib/rate-limit.js).
  // It's defense-in-depth only now: every read already requires a Firebase
  // token whose email matches the requested account, so there's no anonymous
  // enumeration surface left to bound. Fail-open on a Redis blip matches the
  // rest of the rate-limit infra (the owner check above still holds).
  const clientIp = getClientIp(req);
  const ipCheck = await checkIpReadLimit(clientIp);
  if (!ipCheck.ok) {
    console.warn('[feedback-list] IP rate limited', { ipHash: piiHash(clientIp), reason: ipCheck.reason });
    return res.status(429).json({ ok: false, error: 'rate_limited', items: [] });
  }
  await recordRead(clientIp);

  const sinceTs = Date.now() - (days * 24 * 60 * 60 * 1000);

  const result = await listForParent(parentEmail, { sinceTs });

  if (!result.ok) return res.status(500).json(result);

  // ─── PII minimization ─────────────────────────────────────────
  // The caller is the verified owner, but we still drop fields no client
  // renders so the payload carries only the minimum:
  //   - parent {name,email}: rendered by no client → dropped entirely.
  //   - coach.email:         not rendered → dropped (coach name + phone kept
  //                          for the dashboard's tap-to-text follow-up).
  //   - player.phone:        never rendered → dropped (player.name kept; the
  //                          weekly card groups by it).
  const items = (result.items || []).map((it) => {
    const safe = { ...it };
    delete safe.parent;
    if (safe.coach) {
      const { email, ...coachRest } = safe.coach;
      safe.coach = coachRest;
    }
    if (safe.player) {
      const { phone, ...playerRest } = safe.player;
      safe.player = playerRest;
    }
    return safe;
  });

  return res.status(200).json({ ok: true, items });
}
