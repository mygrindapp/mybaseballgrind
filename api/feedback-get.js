// ═══════════════════════════════════════════════════════════
// Phase 7b V1 — Coach-reply page calls this to load a request.
// Token is required; without it the request is unreadable.
// Returns the record with the secret token stripped (the page
// already has the token in the URL — no need to echo it).
// ═══════════════════════════════════════════════════════════

import crypto from 'crypto';
import { getRequest } from '../lib/feedback-store.js';
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

  const id    = (req.query.req || '').toString();
  const token = (req.query.t   || '').toString();
  if (!id || !token) return res.status(400).json({ ok: false, error: 'missing_id_or_token' });

  // ─── Rate limit (H1/M3 — security audit 2026-05-18) ──────
  // Token is 128 bits (16 bytes hex) so brute force is infeasible at
  // single-request speed. But unrate-limited, an attacker could hammer
  // 4xx responses to DoS the endpoint or fish for valid IDs. IP cap of
  // 3/hr 10/day matches the rest of the infra.
  const clientIp = getClientIp(req);
  const ipCheck = await checkIpReadLimit(clientIp);
  if (!ipCheck.ok) {
    console.warn('[feedback-get] IP rate limited', { ipHash: piiHash(clientIp), reason: ipCheck.reason });
    return res.status(429).json({ ok: false, error: 'rate_limited' });
  }
  await recordRead(clientIp);

  const result = await getRequest(id, token);
  if (!result.ok) {
    const status = result.error === 'not_found' ? 404
                 : result.error === 'bad_token' ? 403
                 : 500;
    return res.status(status).json(result);
  }

  // Strip the token from the response — the client already has it
  const safe = { ...result.record };
  delete safe.token;
  return res.status(200).json({ ok: true, record: safe });
}
