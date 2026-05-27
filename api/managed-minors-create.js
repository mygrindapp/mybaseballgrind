// ═══════════════════════════════════════════════════════════
// MyGrind — api/managed-minors-create.js (Phase 3, COPPA)
// ───────────────────────────────────────────────────────────
// Creates a child profile under a parent's account. The parent's active
// Family-plan Stripe charge stands as FTC-accepted verifiable parental
// consent (same pattern Khan Academy Kids, ClassDojo, and Apple Family
// Sharing rely on). Single-plan parents are blocked because Single does
// not include child-profile entitlements.
//
// Auth: Authorization: Bearer <firebase-id-token>. The token's uid is
// the parent; the token's email is what we look up in subscription-store.
//
// Request:  POST { firstName, age, sport, position? }
// Response: 200 { ok: true, minorId, profile }
//           400 missing_fields / age_out_of_range / invalid_sport
//           401 missing_bearer / invalid_token
//           402 no_subscription / subscription_inactive / single_plan_no_children
//           500 storage failures
// ═══════════════════════════════════════════════════════════

import { verifyBearer, assertFamilyPlanActive, getAdminFirestore } from '../lib/firebase-admin.js';

const ALLOWED_ORIGINS = new Set([
  'https://www.mygrindapp.com',
  'https://mygrindapp.com',
]);

const ALLOWED_SPORTS = new Set(['baseball', 'softball']);

function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function trimStr(v, max) {
  return (typeof v === 'string' ? v : '').trim().slice(0, max);
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const auth = await verifyBearer(req);
  if (!auth.ok) {
    const code = auth.error === 'missing_bearer' ? 401 : auth.error === 'invalid_token' ? 401 : 500;
    return res.status(code).json({ ok: false, error: auth.error });
  }
  const parentUid   = auth.uid;
  const parentEmail = auth.email;

  const body = req.body || {};
  const firstName = trimStr(body.firstName, 60);
  const sport     = trimStr(body.sport, 16).toLowerCase();
  const position  = trimStr(body.position || '', 40);
  const ageRaw    = body.age;
  const age       = Number(ageRaw);

  if (!firstName)                          return res.status(400).json({ ok: false, error: 'missing_firstName' });
  if (!ALLOWED_SPORTS.has(sport))          return res.status(400).json({ ok: false, error: 'invalid_sport' });
  if (!Number.isFinite(age) || age < 4 || age >= 18) {
    // Under-18 only: 18+ users create their own Auth account. Lower bound 4
    // matches the youngest realistic baseball/softball age.
    return res.status(400).json({ ok: false, error: 'age_out_of_range' });
  }

  const gate = await assertFamilyPlanActive(parentEmail);
  if (!gate.ok)      return res.status(500).json({ ok: false, error: gate.reason || 'gate_failed' });
  if (!gate.allowed) return res.status(402).json({ ok: false, error: gate.reason, plan: gate.plan || null, status: gate.status || null });

  const db = getAdminFirestore();
  if (!db) return res.status(500).json({ ok: false, error: 'firestore_unavailable' });

  const col = db.collection('users').doc(parentUid).collection('managedMinors');
  const ref = col.doc();
  const now = new Date();
  const profile = {
    firstName,
    age,
    sport,
    position: position || null,
    createdAt: now.toISOString(),
    createdBy: parentUid,
    consentVia: 'stripe_family_plan',
    consentPlan: gate.plan || null,
  };

  try {
    await ref.set(profile);
  } catch (e) {
    console.error('[managed-minors-create] firestore write failed:', e.message);
    return res.status(500).json({ ok: false, error: 'write_failed' });
  }

  return res.status(200).json({ ok: true, minorId: ref.id, profile });
}
