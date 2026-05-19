// ═══════════════════════════════════════════════════════════
// MyGrind — api/get-subscription.js (Phase 5 Step 4)
// ───────────────────────────────────────────────────────────
// Returns the subscription status for a given email so client-side
// surfaces (softball.html paywall, signup.html dashboard) can decide
// whether to gate paid features.
//
// Security note (V1): anyone who knows the customer's email can
// query this endpoint. The data returned is only THEIR own
// subscription state — not other customers'. CORS allowlist limits
// to mygrindapp.com origins. V2 (full account auth) will scope this
// to the signed-in user's claim.
// ═══════════════════════════════════════════════════════════

import { getSubscription } from '../lib/subscription-store.js';

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

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')     return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const email = (req.query.email || '').toString();
  if (!email) return res.status(400).json({ ok: false, error: 'missing_email' });

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
