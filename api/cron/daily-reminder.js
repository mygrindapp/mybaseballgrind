// ═══════════════════════════════════════════════════════════
// MyGrind — api/cron/daily-reminder.js  (Web Push daily reminder, Phase C)
// ───────────────────────────────────────────────────────────
// Sends the daily "log your grind" push to subscribed devices via web-push.
// Reads subscriptions from Firestore (lib/push-store). Prunes dead ones (404/410).
//
// Auth: Vercel attaches `Authorization: Bearer ${CRON_SECRET}` to scheduled
// invocations; manual fires (curl) must include the same header.
//
// Env:
//   CRON_SECRET        — required, gates this endpoint
//   VAPID_PUBLIC_KEY   — required (same key embedded in softball.html)
//   VAPID_PRIVATE_KEY  — required, Sensitive
//   VAPID_SUBJECT      — required, e.g. mailto:support@mygrindapp.com
//   PUSH_DRY_RUN       — defaults ON. Set to 'false' to actually send on the
//                        scheduled run. While ON, scheduled runs only log.
//   PUSH_CRON_MODE     — 'daily' (default): send to ALL enabled subs at the one
//                        scheduled run (works on Vercel Hobby's daily cron).
//                        'hourly': send only to subs whose LOCAL hour == now
//                        (use with an hourly schedule on Vercel Pro to honor each
//                        player's chosen reminder time).
//   CREATOR_EMAIL      — optional. ?test=1 targets only this email's device(s).
//
// Query params (all require auth):
//   ?dry=1    — compute + log, never send
//   ?test=1   — send NOW to CREATOR_EMAIL's device(s) (or the newest sub if
//               unset), ignoring hour + PUSH_DRY_RUN. Use to verify on your phone.
//   ?limit=N  — cap sends in one run
// ═══════════════════════════════════════════════════════════

import webpush from 'web-push';
import { listEnabledSubscriptions, deletePushSubscription } from '../../lib/push-store.js';

const MSGS = [
  "Log today's grind. Two minutes keeps your streak alive.",
  "Did you log today? Your journal is waiting.",
  "Close the book on today. One honest entry.",
  "Keep your streak going. Log today's work.",
  "Today counts. Log your game or practice.",
];

function authorize(req) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return (req.headers.authorization || '') === `Bearer ${expected}`;
}

function localHour(tz, now) {
  try {
    return parseInt(new Intl.DateTimeFormat('en-US', { timeZone: tz || 'America/Los_Angeles', hour: 'numeric', hour12: false }).format(now), 10) % 24;
  } catch (e) { return null; }
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  if (!authorize(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });

  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY, subj = process.env.VAPID_SUBJECT;
  if (!pub || !priv || !subj) {
    console.error('[daily-reminder] VAPID env not set');
    return res.status(500).json({ ok: false, error: 'vapid_not_configured' });
  }
  webpush.setVapidDetails(subj, pub, priv);

  const test    = String(req.query.test || '') === '1';
  const dryQ    = String(req.query.dry || '') === '1';
  const limit   = Math.max(0, parseInt(req.query.limit, 10) || 0);
  const dryRun  = dryQ || (process.env.PUSH_DRY_RUN !== 'false' && !test);
  const mode    = process.env.PUSH_CRON_MODE === 'hourly' ? 'hourly' : 'daily';
  const now     = new Date();

  const all = await listEnabledSubscriptions();
  if (!all.ok) return res.status(500).json({ ok: false, error: all.error });

  // Pick recipients
  let targets;
  if (test) {
    const creator = (process.env.CREATOR_EMAIL || '').trim().toLowerCase();
    if (creator) targets = all.subs.filter(s => (s.email || '') === creator);
    else targets = all.subs.slice().sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))).slice(0, 1);
  } else if (mode === 'hourly') {
    targets = all.subs.filter(s => localHour(s.tz, now) === s.hour);
  } else {
    targets = all.subs; // daily mode: everyone, once, at the single scheduled run
  }
  if (limit > 0) targets = targets.slice(0, limit);

  if (dryRun) {
    console.log('[daily-reminder] DRY RUN', { mode, test, totalEnabled: all.subs.length, wouldSend: targets.length });
    return res.status(200).json({ ok: true, dryRun: true, mode, totalEnabled: all.subs.length, wouldSend: targets.length });
  }

  const body = MSGS[now.getUTCDate() % MSGS.length];
  const payload = JSON.stringify({ title: 'MyGrind', body, url: '/softball.html#journal', tag: 'mygrind-daily' });

  let sent = 0, pruned = 0, failed = 0;
  for (const s of targets) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload);
      sent++;
    } catch (err) {
      if (err && (err.statusCode === 404 || err.statusCode === 410)) {
        try { await deletePushSubscription(s.endpoint); pruned++; } catch (e) {}
      } else {
        failed++;
        console.warn('[daily-reminder] send failed', { code: err && err.statusCode });
      }
    }
  }

  console.log('[daily-reminder] done', { mode, test, sent, pruned, failed });
  return res.status(200).json({ ok: true, mode, test, sent, pruned, failed, totalEnabled: all.subs.length });
}
