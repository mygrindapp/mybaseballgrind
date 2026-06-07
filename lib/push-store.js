// ═══════════════════════════════════════════════════════════
// MyGrind — lib/push-store.js  (Web Push daily reminder, Phase B)
// ───────────────────────────────────────────────────────────
// Firestore-backed store for Web Push subscriptions, one doc per device
// subscription (keyed by a hash of the push endpoint so a device re-subscribing
// upserts instead of duplicating). Uses the shared Admin SDK init in
// lib/firebase-admin.js — same path the COPPA managed-minor endpoints use.
//
// Email is OPTIONAL metadata: many players are local-only with no account, and
// push works without it (the subscription itself is the credential to reach the
// device). Email, when present, lets a later phase skip players who already
// logged today.
//
// Read by the daily-reminder cron (Phase C) via listEnabledSubscriptions().
// ═══════════════════════════════════════════════════════════

import crypto from 'crypto';
import { getAdminFirestore } from './firebase-admin.js';

const COLLECTION = 'pushSubscriptions';

function endpointId(endpoint) {
  return crypto.createHash('sha256').update(String(endpoint)).digest('hex').slice(0, 40);
}
function normEmail(e) { return (e || '').trim().toLowerCase(); }

export async function savePushSubscription({ subscription, tz, hour, email }) {
  const db = getAdminFirestore();
  if (!db) return { ok: false, error: 'storage_unavailable' };
  if (!subscription || !subscription.endpoint || !subscription.keys) {
    return { ok: false, error: 'invalid_subscription' };
  }
  const id = endpointId(subscription.endpoint);
  const ref = db.collection(COLLECTION).doc(id);
  const now = new Date().toISOString();

  // Preserve original createdAt on re-subscribe.
  let createdAt = now;
  try { const snap = await ref.get(); if (snap.exists && snap.data().createdAt) createdAt = snap.data().createdAt; } catch (e) {}

  const record = {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: (subscription.keys && subscription.keys.p256dh) || '',
      auth:   (subscription.keys && subscription.keys.auth)   || '',
    },
    tz:      tz || 'America/Los_Angeles',
    hour:    (typeof hour === 'number' && hour >= 0 && hour <= 23) ? hour : 18,
    email:   normEmail(email) || null,
    enabled: true,
    createdAt,
    updatedAt: now,
  };

  try { await ref.set(record, { merge: true }); return { ok: true, id }; }
  catch (e) { console.error('[push-store] save failed:', e.message); return { ok: false, error: 'write_failed' }; }
}

export async function deletePushSubscription(endpoint) {
  const db = getAdminFirestore();
  if (!db) return { ok: false, error: 'storage_unavailable' };
  if (!endpoint) return { ok: false, error: 'missing_endpoint' };
  try { await db.collection(COLLECTION).doc(endpointId(endpoint)).delete(); return { ok: true }; }
  catch (e) { console.error('[push-store] delete failed:', e.message); return { ok: false, error: 'delete_failed' }; }
}

// Phase C — the daily-reminder cron loads enabled subs and filters by local hour.
export async function listEnabledSubscriptions() {
  const db = getAdminFirestore();
  if (!db) return { ok: false, error: 'storage_unavailable', subs: [] };
  try {
    const snap = await db.collection(COLLECTION).where('enabled', '==', true).get();
    const subs = [];
    snap.forEach(d => subs.push(Object.assign({ id: d.id }, d.data())));
    return { ok: true, subs };
  } catch (e) {
    console.error('[push-store] list failed:', e.message);
    return { ok: false, error: 'read_failed', subs: [] };
  }
}
