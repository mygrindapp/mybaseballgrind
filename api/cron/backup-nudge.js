// ═══════════════════════════════════════════════════════════
// MyGrind — api/cron/backup-nudge.js
// ───────────────────────────────────────────────────────────
// Weekly "protect your player's journal" nudge.
//
// WHY THIS IS NOT A RECURRING "REMEMBER TO BACK UP" REMINDER
// ──────────────────────────────────────────────────────────
// The journal is LOCAL-FIRST. Entries write to localStorage and the app
// works fully signed-out and offline. But every saveEntry() already calls
// fbSaveEntry() behind an `if (fbUser)` guard (softball.html ~10496 /
// ~10843 / ~10859), so the moment an account is SIGNED IN, every entry
// from then on syncs to Firestore automatically, forever, with no user
// action. bulkBackupToCloud() is only a one-time catch-up for entries
// created before that first sign-in.
//
// So there is no ongoing chore to remind anyone about. There is exactly
// ONE thing a customer has to do, ONCE: sign in. After that they are
// protected permanently. Emailing a synced customer a weekly "don't
// forget to back up" would be both wrong (there is nothing to do) and
// off-brand (nagging). This job therefore:
//
//   - targets ONLY accounts with zero cloud entries,
//   - self-extinguishes the moment an account has any cloud entry,
//   - is capped at MAX_SENDS total per account, ever,
//   - honours the existing digest opt-out.
//
// Discovered 2026-07-22 (Kelly Balconi): a blank "Signed In" in Firebase
// Auth means NO CLOUD SYNC, not "never used the app." Her son had been
// journaling locally for a week. See memory `firebase-signin-is-not-usage`.
//
// Auth: Vercel attaches `Authorization: Bearer ${CRON_SECRET}` to
// scheduled invocations. Manual fires (curl) must include the same header.
//
// Env:
//   CRON_SECRET     — required, gates this endpoint + HMAC unsubscribe key
//   RESEND_API_KEY  — required to actually send
//   RESEND_FROM     — sender, default 'Coach Young — MyGrind <coach@mygrindapp.com>'
//   REDIS_URL       — required, send caps + opt-out flags
//   FIREBASE_*      — via lib/firebase-admin.js
//
// Query params (all optional, all require auth):
//   ?dry=1     — render + report, send nothing. THIS IS THE DEFAULT.
//   ?live=1    — actually send. Must be passed explicitly.
//   ?limit=N   — cap sends in one run
//   ?only=a@b  — restrict to a single email (smoke test)
//
// SAFETY: dry-run is the default. A bare cron fire with neither flag
// reports what it WOULD send and sends nothing, so a misconfigured
// schedule can never blast customers.
// ═══════════════════════════════════════════════════════════

import Redis from 'ioredis';
import { Resend } from 'resend';
import crypto from 'crypto';
import { getAdminAuth, getAdminFirestore } from '../../lib/firebase-admin.js';

const APP_URL = 'https://www.mygrindapp.com';

// SCOPE (Coach, 2026-07-22): FREE side AND paid both get this. Losing a
// journal hurts a free user exactly as much as a paying one, and an
// unprotected free user is the one most likely to walk away and never
// come back. So this scans every Firebase Auth identity and does NOT
// filter on subscription status.
//
// Standing per-person exceptions, from prior decisions. Matched by exact
// address OR prefix (some full addresses are truncated in the console).
// `?only=` deliberately BYPASSES this list so Coach can still send
// himself a test.
const NEVER_NUDGE = [
  'youngsbaseball@gmail.com',  // Coach's own account
  'mia@sitesfam',              // standing: never nudge
  'dj.milonas@d1training',     // D1 partner, standing: never nudge
  'phillfirst@gmail.com',      // on hold
];
function isSuppressed(email) {
  return NEVER_NUDGE.some((m) => email === m || email.startsWith(m));
}

// Never nudge the same account more than this many times, ever.
const MAX_SENDS = 3;
// Minimum gap between nudges to one account.
const MIN_GAP_MS = 7 * 24 * 60 * 60 * 1000;
// Don't nudge an account created in the last 3 days — let onboarding land first.
const MIN_ACCOUNT_AGE_MS = 3 * 24 * 60 * 60 * 1000;

const C = {
  bg: '#1A1410',
  gold: '#D4A574',
  cream: '#F5EDE0',
  muted: '#B4A48C',
};

function piiHash(email) {
  return crypto.createHash('sha256').update(String(email).toLowerCase()).digest('hex').slice(0, 12);
}

// Same construction as api/cron/weekly-digest.js + api/digest-unsubscribe.js
function buildUnsubscribeUrl(email) {
  const secret = process.env.CRON_SECRET || '';
  const token = crypto.createHmac('sha256', secret)
    .update(email.toLowerCase().trim())
    .digest('hex')
    .slice(0, 16);
  return `${APP_URL}/api/digest-unsubscribe?email=${encodeURIComponent(email)}&token=${token}`;
}

// Deep link: lands on sign-in with the email prefilled, and carries
// next=backup so softball.html surfaces the Save-to-Cloud card as soon
// as they land. signin.html forwards `next` through its redirect.
function buildBackupUrl(email) {
  return `${APP_URL}/signin.html?email=${encodeURIComponent(email)}&next=backup`;
}

// ── Email body ────────────────────────────────────────────────────
// Brand voice: "your player" / they, one-word MyGrind, signed "Coach",
// no em-dashes, no hype words, supportive not nagging.
function buildNudge({ email, sendNumber }) {
  const backupUrl = buildBackupUrl(email);
  const unsubscribeUrl = buildUnsubscribeUrl(email);

  const subject = sendNumber === 1
    ? "One tap protects your player's journal"
    : "Your player's journal is still only on one device";

  const text = [
    "Every entry your player writes is saved on their device right away, so the journal works anywhere, even with no signal.",
    "",
    "The one thing it does not do yet is copy itself somewhere safe. If that phone is lost, replaced, or wiped, the entries go with it.",
    "",
    "Signing in once fixes that permanently. After that first sign-in, every entry saves to the cloud on its own. There is nothing to remember and nothing to repeat, and the journal comes back on any device they sign in on.",
    "",
    "Protect the journal: " + backupUrl,
    "",
    "It takes about thirty seconds. We email a 6-digit code, they type it in, done.",
    "",
    "Coach",
    "",
    "",
    "You are getting this because your player's journal has not synced yet. It stops on its own once it has.",
    "Unsubscribe: " + unsubscribeUrl,
  ].join("\n");

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:${C.bg};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${C.bg};">

<tr><td style="padding-bottom:24px;">
  <div style="font-family:'Barlow Condensed',Arial,sans-serif;font-size:13px;letter-spacing:2px;text-transform:uppercase;color:${C.gold};">MyGrind</div>
</td></tr>

<tr><td style="font-family:Barlow,Arial,sans-serif;font-size:17px;line-height:1.6;color:${C.cream};padding-bottom:18px;">
  Every entry your player writes is saved on their device right away, so the journal works anywhere, even with no signal.
</td></tr>

<tr><td style="font-family:Barlow,Arial,sans-serif;font-size:17px;line-height:1.6;color:${C.cream};padding-bottom:18px;">
  The one thing it does not do yet is copy itself somewhere safe. If that phone is lost, replaced, or wiped, the entries go with it.
</td></tr>

<tr><td style="font-family:Barlow,Arial,sans-serif;font-size:17px;line-height:1.6;color:${C.cream};padding-bottom:28px;">
  Signing in once fixes that permanently. After that first sign-in, every entry saves to the cloud on its own. There is nothing to remember and nothing to repeat, and the journal comes back on any device they sign in on.
</td></tr>

<tr><td align="center" style="padding-bottom:28px;">
  <a href="${backupUrl}" style="display:inline-block;background:${C.gold};color:${C.bg};font-family:'Barlow Condensed',Arial,sans-serif;font-size:18px;letter-spacing:1px;text-transform:uppercase;text-decoration:none;padding:15px 38px;border-radius:6px;font-weight:600;">Protect the journal</a>
</td></tr>

<tr><td style="font-family:Barlow,Arial,sans-serif;font-size:15px;line-height:1.6;color:${C.muted};padding-bottom:28px;" align="center">
  It takes about thirty seconds. We email a 6-digit code, they type it in, done.
</td></tr>

<tr><td style="font-family:Barlow,Arial,sans-serif;font-size:17px;line-height:1.6;color:${C.cream};padding-bottom:32px;">
  Coach
</td></tr>

<tr><td style="border-top:1px solid #3A2F26;padding-top:18px;font-family:Barlow,Arial,sans-serif;font-size:13px;line-height:1.6;color:${C.muted};">
  You are getting this because your player's journal has not synced yet. It stops on its own once it has.<br>
  <a href="${unsubscribeUrl}" style="color:${C.muted};">Unsubscribe</a>
</td></tr>

</table>
</td></tr></table>
</body></html>`;

  return { subject, html, text };
}

// ── Redis ─────────────────────────────────────────────────────────
let redis = null;
function getRedis() {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (!redis) {
    redis = new Redis(url, { maxRetriesPerRequest: 2, enableReadyCheck: false });
    redis.on('error', (e) => console.error('[backup-nudge] redis error:', e.message));
  }
  return redis;
}

// ── Handler ───────────────────────────────────────────────────────
export default async function handler(req, res) {
  // Auth
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[backup-nudge] CRON_SECRET not set');
    return res.status(500).json({ ok: false, error: 'not_configured' });
  }
  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${secret}`) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  // dry is the DEFAULT. You must pass ?live=1 to actually send.
  const live = String(req.query.live || '') === '1';
  const limit = req.query.limit ? parseInt(req.query.limit, 10) : Infinity;
  const only = (req.query.only || '').toLowerCase().trim();

  const r = getRedis();
  if (!r) return res.status(500).json({ ok: false, error: 'redis_not_configured' });

  let adminAuth, db;
  try {
    adminAuth = getAdminAuth();
    db = getAdminFirestore();
  } catch (e) {
    console.error('[backup-nudge] firebase admin init failed:', e.message);
    return res.status(500).json({ ok: false, error: 'firebase_unavailable' });
  }
  if (!adminAuth || !db) {
    return res.status(500).json({ ok: false, error: 'firebase_unavailable' });
  }

  const results = {
    live,
    scanned: 0,
    protected_skipped: 0,   // already syncing — the good outcome
    suppressed: 0,          // standing never-nudge list
    too_new: 0,
    optout: 0,
    capped: 0,              // hit MAX_SENDS or inside MIN_GAP
    would_send: 0,
    sent: 0,
    failed: 0,
    recipients: [],
  };

  const now = Date.now();
  const resend = live ? new Resend(process.env.RESEND_API_KEY) : null;
  const from = process.env.RESEND_FROM || 'Coach Young — MyGrind <coach@mygrindapp.com>';

  // Page through every Firebase Auth identity.
  let pageToken = undefined;
  do {
    const page = await adminAuth.listUsers(1000, pageToken);
    pageToken = page.pageToken;

    for (const user of page.users) {
      const email = (user.email || '').toLowerCase().trim();
      if (!email) continue;
      if (only && email !== only) continue;

      results.scanned++;

      // 0. Standing never-nudge list. `?only=` bypasses it on purpose so a
      //    single-address smoke test still works.
      if (!only && isSuppressed(email)) {
        results.suppressed++;
        continue;
      }

      // 0b. Fast path: a previous run already proved this account is
      //     syncing. Auto-sync is permanent once on, so skip the read.
      try {
        if (await r.exists('mg:backup_nudge:done:' + email)) {
          results.protected_skipped++;
          continue;
        }
      } catch (e) {}

      // 1. Already protected? Any cloud entry at all means auto-sync is
      //    live for this account and it never needs this email again.
      let hasCloud = false;
      try {
        const snap = await db.collection('users').doc(user.uid)
          .collection('entries').limit(1).get();
        hasCloud = !snap.empty;
      } catch (e) {
        console.warn('[backup-nudge] firestore read failed for', piiHash(email), e.message);
        // Fail SAFE: if we cannot prove they are unprotected, do not email.
        continue;
      }
      if (hasCloud) {
        results.protected_skipped++;
        // Stamp so future runs can skip the Firestore read entirely.
        try { await r.set('mg:backup_nudge:done:' + email, '1'); } catch (e) {}
        continue;
      }

      // 2. Brand new account — let onboarding land before nudging.
      const created = Date.parse(user.metadata?.creationTime || '') || 0;
      if (created && (now - created) < MIN_ACCOUNT_AGE_MS) {
        results.too_new++;
        continue;
      }

      // 3. Opted out of MyGrind email (shared flag with the weekly digest).
      try {
        if (await r.exists('feedback:digest-optout:' + email)) {
          results.optout++;
          continue;
        }
      } catch (e) {}

      // 4. Send caps.
      const countKey = 'mg:backup_nudge:count:' + email;
      const lastKey  = 'mg:backup_nudge:last:' + email;
      let sentCount = 0, lastAt = 0;
      try {
        sentCount = parseInt((await r.get(countKey)) || '0', 10) || 0;
        lastAt = parseInt((await r.get(lastKey)) || '0', 10) || 0;
      } catch (e) {}

      if (sentCount >= MAX_SENDS || (lastAt && (now - lastAt) < MIN_GAP_MS)) {
        results.capped++;
        continue;
      }

      if (results.would_send + results.sent >= limit) continue;

      const sendNumber = sentCount + 1;
      const { subject, html, text } = buildNudge({ email, sendNumber });

      if (!live) {
        results.would_send++;
        results.recipients.push({ email, sendNumber, subject });
        continue;
      }

      try {
        const out = await resend.emails.send({ from, to: email, subject, html, text });
        if (out && out.error) throw new Error(out.error.message || 'resend_error');
        results.sent++;
        results.recipients.push({ email, sendNumber, subject });
        try {
          await r.set(countKey, String(sendNumber));
          await r.set(lastKey, String(now));
        } catch (e) {}
        console.log('[backup-nudge] sent', { emailHash: piiHash(email), sendNumber });
      } catch (e) {
        results.failed++;
        console.error('[backup-nudge] send failed', { emailHash: piiHash(email), err: e.message });
      }
    }
  } while (pageToken);

  return res.status(200).json({ ok: true, ...results });
}
