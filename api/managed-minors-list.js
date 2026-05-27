// ═══════════════════════════════════════════════════════════
// MyGrind — api/managed-minors-list.js (Phase 3, COPPA)
// ───────────────────────────────────────────────────────────
// Returns the array of child profiles under the calling parent. Used by
// softball.html to render the profile switcher.
//
// Auth: Authorization: Bearer <firebase-id-token>. We list only minors
// under that parent's uid — there's no cross-account read path.
//
// Note: we do NOT gate the LIST endpoint on Family-plan status. A parent
// whose subscription lapsed should still be able to SEE and DELETE their
// child's data (parental rights survive cancellation). The CREATE endpoint
// is what enforces Family-plan-only.
// ═══════════════════════════════════════════════════════════

import { verifyBearer, getAdminFirestore } from '../lib/firebase-admin.js';

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

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')     return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const auth = await verifyBearer(req);
  if (!auth.ok) {
    const code = auth.error === 'missing_bearer' || auth.error === 'invalid_token' ? 401 : 500;
    return res.status(code).json({ ok: false, error: auth.error });
  }
  const parentUid = auth.uid;

  const db = getAdminFirestore();
  if (!db) return res.status(500).json({ ok: false, error: 'firestore_unavailable' });

  try {
    const snap = await db.collection('users').doc(parentUid).collection('managedMinors').get();
    const minors = [];
    snap.forEach(function(doc) {
      const d = doc.data() || {};
      minors.push({
        minorId:   doc.id,
        firstName: d.firstName || '',
        age:       typeof d.age === 'number' ? d.age : null,
        sport:     d.sport || null,
        position:  d.position || null,
        createdAt: d.createdAt || null,
      });
    });
    // Stable sort by createdAt (oldest first) so the dropdown order doesn't
    // shuffle between renders.
    minors.sort(function(a, b) {
      const aT = a.createdAt || '';
      const bT = b.createdAt || '';
      return aT < bT ? -1 : aT > bT ? 1 : 0;
    });
    return res.status(200).json({ ok: true, minors });
  } catch (e) {
    console.error('[managed-minors-list] read failed:', e.message);
    return res.status(500).json({ ok: false, error: 'read_failed' });
  }
}
