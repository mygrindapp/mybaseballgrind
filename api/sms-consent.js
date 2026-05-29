// ═══════════════════════════════════════════════════════════
// MyGrind — api/sms-consent.js
// ───────────────────────────────────────────────────────────
// Records explicit SMS opt-in consent captured by the standalone consent
// checkbox on the signup phone-confirm step. Gives us a durable, timestamped,
// server-side record of opt-in (Firestore collection `smsConsents`) that a
// carrier or Twilio can request as proof during toll-free verification
// (ticket #27140216). The client also keeps a localStorage fallback, so this
// endpoint never blocks the user flow: any failure still returns ok.
//
// No auth: the phone-confirm step happens before account creation. We apply a
// lenient read-tier IP rate limit (fail-open) purely to deter bulk abuse, and
// we do NOT persist the raw IP (no new PII beyond the consented number).
//
// Request:  POST { recipientNumber:"+1XXXXXXXXXX", consented:true,
//                  consentVersion, consentText, method, page, timestampISO }
// Response: 200 { ok:true, stored:"firestore"|"client_only" }
//           400 invalid_number / not_consented
//           405 method_not_allowed
//           429 rate_limited
// ═══════════════════════════════════════════════════════════

import { getAdminFirestore } from '../lib/firebase-admin.js';
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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  const first = Array.isArray(xf) ? xf[0] : (xf || '').split(',')[0];
  return (first || '').trim() || (req.socket && req.socket.remoteAddress) || 'unknown';
}

function trimStr(v, max) {
  return (typeof v === 'string' ? v : '').trim().slice(0, max);
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const ip = clientIp(req);
  const lim = await checkIpReadLimit(ip);
  if (!lim.ok) return res.status(429).json({ ok: false, error: 'rate_limited' });

  const body = req.body || {};
  const recipientNumber = trimStr(body.recipientNumber, 20);
  if (!/^\+1\d{10}$/.test(recipientNumber)) return res.status(400).json({ ok: false, error: 'invalid_number' });
  if (body.consented !== true)              return res.status(400).json({ ok: false, error: 'not_consented' });

  const record = {
    recipientNumber,
    consented: true,
    consentVersion: trimStr(body.consentVersion, 40) || 'unknown',
    consentText: trimStr(body.consentText, 2000),
    method: trimStr(body.method, 40) || 'web_form_checkbox',
    page: trimStr(body.page, 300),
    timestampISO: trimStr(body.timestampISO, 40) || new Date().toISOString(),
    recordedAt: new Date().toISOString(),
  };

  const db = getAdminFirestore();
  if (!db) {
    // Firestore unavailable: client already holds the localStorage fallback.
    return res.status(200).json({ ok: true, stored: 'client_only' });
  }

  try {
    await db.collection('smsConsents').add(record);
  } catch (e) {
    console.error('[sms-consent] firestore write failed:', e.message);
    // Never block the user flow — the localStorage fallback still exists.
    return res.status(200).json({ ok: true, stored: 'client_only' });
  }

  recordRead(ip).catch(function () { /* counter best-effort */ });
  return res.status(200).json({ ok: true, stored: 'firestore' });
}
