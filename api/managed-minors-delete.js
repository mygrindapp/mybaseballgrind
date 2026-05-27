// ═══════════════════════════════════════════════════════════
// MyGrind — api/managed-minors-delete.js (Phase 3, COPPA)
// ───────────────────────────────────────────────────────────
// Permanently deletes a child profile + every entry under it. COPPA gives
// the parent an unconditional right to delete their child's data, so this
// endpoint is intentionally not gated on subscription status. A parent
// whose Family plan lapsed must still be able to purge child data.
//
// Auth: Authorization: Bearer <firebase-id-token>. The parent's uid is
// the only path under which a managedMinor doc lives, so an attacker
// holding another user's token cannot reach this parent's child docs.
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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// Recursively-batch delete a doc + its known subcollections. Firestore client
// SDK has no native recursive delete; the Admin SDK has a one-shot helper but
// only for collections, not paths. The known children-of-children we need to
// purge today: /entries. If new sub-collections are added later, list them
// here so deletion stays complete.
const SUBCOLLECTIONS = ['entries'];

async function purgeMinor(db, parentUid, minorId) {
  const minorRef = db.collection('users').doc(parentUid).collection('managedMinors').doc(minorId);

  for (const sub of SUBCOLLECTIONS) {
    const subCol = minorRef.collection(sub);
    // Page through up to 500 docs per batch (Firestore commit cap).
    while (true) {
      const snap = await subCol.limit(500).get();
      if (snap.empty) break;
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      if (snap.size < 500) break;
    }
  }

  await minorRef.delete();
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const auth = await verifyBearer(req);
  if (!auth.ok) {
    const code = auth.error === 'missing_bearer' || auth.error === 'invalid_token' ? 401 : 500;
    return res.status(code).json({ ok: false, error: auth.error });
  }
  const parentUid = auth.uid;

  const minorId = (req.body && typeof req.body.minorId === 'string') ? req.body.minorId.trim() : '';
  if (!minorId) return res.status(400).json({ ok: false, error: 'missing_minorId' });

  const db = getAdminFirestore();
  if (!db) return res.status(500).json({ ok: false, error: 'firestore_unavailable' });

  // Ownership check — the path itself enforces it, but a missing doc means
  // the parent is asking us to delete something that isn't theirs (or never
  // existed). Return 404 so the UI can show the right message.
  const minorRef = db.collection('users').doc(parentUid).collection('managedMinors').doc(minorId);
  let snap;
  try {
    snap = await minorRef.get();
  } catch (e) {
    console.error('[managed-minors-delete] lookup failed:', e.message);
    return res.status(500).json({ ok: false, error: 'lookup_failed' });
  }
  if (!snap.exists) return res.status(404).json({ ok: false, error: 'not_found' });

  try {
    await purgeMinor(db, parentUid, minorId);
  } catch (e) {
    console.error('[managed-minors-delete] purge failed:', e.message);
    return res.status(500).json({ ok: false, error: 'delete_failed' });
  }

  return res.status(200).json({ ok: true });
}
