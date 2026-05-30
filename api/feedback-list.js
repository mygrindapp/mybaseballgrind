// ═══════════════════════════════════════════════════════════
// Phase 7b V1 — Lists feedback request/response records for a
// player (by phone) or parent (by email). Drives the "New from
// Coach" card on softball.html and the "This Week's Coaching"
// card on signup.html Screen 8.
//
// Security note for V1: anyone who knows the player's phone or
// the parent's email can list their feedback. That is acceptable
// for V1 because (a) phone/email are personal info already in
// each user's localStorage, (b) the data shown is only their
// own coach interactions, and (c) the secret token gate still
// protects writes. V2 (full coach app) will replace this with
// Firebase auth-scoped reads.
// ═══════════════════════════════════════════════════════════

import crypto from 'crypto';
import { listForPlayer, listForParent } from '../lib/feedback-store.js';
import { checkIpReadLimit, recordRead } from '../lib/rate-limit.js';

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
  if (req.method !== 'GET')     return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const playerPhone = (req.query.player || '').toString();
  const parentEmail = (req.query.parent || '').toString();
  const days        = Math.max(1, Math.min(90, parseInt(req.query.days || '30', 10) || 30));

  if (!playerPhone && !parentEmail) {
    return res.status(400).json({ ok: false, error: 'missing_filter', items: [] });
  }

  // ─── Rate limit (H1 partial — security audit 2026-05-18) ──
  // Defeats bulk phone enumeration: an attacker trying many phones to
  // find which return data hits the 3/hr 10/day IP cap quickly. Does
  // NOT defeat a TARGETED attack where someone already knows a specific
  // player's phone — that residual risk is documented and queued for
  // V2 (full Firebase auth scope per the file's existing security note).
  // Fail-open on Redis outage matches the rest of the rate-limit infra.
  const clientIp = getClientIp(req);
  const ipCheck = await checkIpReadLimit(clientIp);
  if (!ipCheck.ok) {
    console.warn('[feedback-list] IP rate limited', { ipHash: piiHash(clientIp), reason: ipCheck.reason });
    return res.status(429).json({ ok: false, error: 'rate_limited', items: [] });
  }
  await recordRead(clientIp);

  const sinceTs = Date.now() - (days * 24 * 60 * 60 * 1000);

  const result = playerPhone
    ? await listForPlayer(playerPhone, { sinceTs })
    : await listForParent(parentEmail, { sinceTs });

  if (!result.ok) return res.status(500).json(result);

  // ─── PII minimization (interim hardening 2026-05-29) ──────────
  // This V1 endpoint is not yet auth-scoped (see the file header), so we
  // return only the fields the dashboard cards actually render and drop the
  // identifiers no client reads. Removes a minor's parent email + parent/
  // player names + player phone from the response, so even an unauthorized
  // caller who knows a phone/email gets coaching content, not a contact graph.
  //   - parent {name,email}: rendered by no client → dropped entirely.
  //   - coach.email:         not rendered → dropped (coach name/phone kept for
  //                          the player's tap-to-text follow-up).
  //   - player.phone:        never rendered (player path already knows it) →
  //                          dropped. player.name kept only on the parent
  //                          query, where the weekly card groups by it.
  const isParentQuery = !!parentEmail;
  const items = (result.items || []).map((it) => {
    const safe = { ...it };
    delete safe.parent;
    if (safe.coach) {
      const { email, ...coachRest } = safe.coach;
      safe.coach = coachRest;
    }
    if (safe.player) {
      const { phone, ...playerRest } = safe.player;
      safe.player = isParentQuery ? playerRest : undefined;
    }
    return safe;
  });

  return res.status(200).json({ ok: true, items });
}
