// ═══════════════════════════════════════════════════════════
// MyGrind — api/cron/weekly-digest.js (Phase 7b V1.5)
// ───────────────────────────────────────────────────────────
// Vercel cron job: every Monday at 14:00 UTC (~7am PDT / 6am PST).
// Scans the feedback-store for every parent email that has had
// activity in the past 7 days, builds a per-parent digest, and
// sends it via Resend.
//
// Auth: Vercel attaches `Authorization: Bearer ${CRON_SECRET}`
// to all scheduled cron invocations. Manual fires (curl) must
// include the same header.
//
// Env:
//   RESEND_API_KEY              — required, prod credential
//   CRON_SECRET                 — required, gates this endpoint
//   RESEND_FROM                 — sender, default 'MyGrind <onboarding@resend.dev>'
//                                 (soft-launch default — switch to
//                                 'MyGrind <notifications@mygrindapp.com>' once
//                                 DNS is verified in Resend)
//   WEEKLY_DIGEST_TEST_EMAIL    — optional, redirect ALL digests to this
//                                 address. Set this until mygrindapp.com is
//                                 verified in Resend. Resend's `onboarding@resend.dev`
//                                 sender is restricted to your own account email,
//                                 so this MUST be your Resend account email
//                                 during test mode.
//
// Query params (all optional, all require auth):
//   ?dry=1      — render + log everything, skip Resend send
//   ?limit=N    — cap the number of digests sent in one run
//
// Idempotency: this is a weekly fire. Re-running the same Monday
// will email twice; that's a known limitation of V1.5. V2 should
// stamp `feedback:digest:<email>:<isoWeek>` keys to prevent dupes.
// ═══════════════════════════════════════════════════════════

import Redis from 'ioredis';
import { Resend } from 'resend';
import crypto from 'crypto';
import { buildDigest } from '../../lib/email-digest.js';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const APP_URL = 'https://www.mygrindapp.com';

// Per-parent HMAC unsubscribe URL. Coach Young 2026-05-17 — CAN-SPAM
// compliance + parent trust. Reuses CRON_SECRET as the HMAC key so
// no new env var needed. First 16 hex chars (8 bytes) is plenty for
// a tamper-proof URL token. Verified by api/digest-unsubscribe.js
// which uses the same construction.
function buildUnsubscribeUrl(parentEmail) {
  const secret = process.env.CRON_SECRET || '';
  const token = crypto.createHmac('sha256', secret)
    .update(parentEmail.toLowerCase().trim())
    .digest('hex')
    .slice(0, 16);
  return `${APP_URL}/api/digest-unsubscribe?email=${encodeURIComponent(parentEmail)}&token=${token}`;
}

let redis = null;
function getRedis() {
  if (redis) return redis;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  redis = new Redis(url, { maxRetriesPerRequest: 2, enableReadyCheck: false });
  redis.on('error', (e) => console.error('[weekly-digest] redis error:', e.message));
  return redis;
}

// SCAN through every `feedback:parent:*` key. Returns deduped emails.
async function listAllParentEmails(r) {
  const emails = new Set();
  let cursor = '0';
  do {
    const [next, keys] = await r.scan(cursor, 'MATCH', 'feedback:parent:*', 'COUNT', 200);
    cursor = next;
    for (const k of keys) {
      const email = k.slice('feedback:parent:'.length);
      if (email) emails.add(email);
    }
  } while (cursor !== '0');
  return [...emails];
}

// Pull the past 7 days of feedback request items for one parent,
// already filtered to those with a coach response attached.
async function loadResponsedItems(r, parentEmail) {
  const sinceTs = Date.now() - SEVEN_DAYS_MS;
  const ids = await r.zrangebyscore('feedback:parent:' + parentEmail, sinceTs, '+inf');
  if (!ids.length) return [];
  const items = [];
  for (const id of ids) {
    const raw = await r.get('feedback:req:' + id);
    if (!raw) continue;
    try {
      const rec = JSON.parse(raw);
      if (rec.status === 'responded' && rec.response) {
        delete rec.token; // never leak the magic-link secret into emails
        items.push(rec);
      }
    } catch { /* skip bad json */ }
  }
  // Newest first
  items.sort((a, b) => new Date(b.response?.respondedAt || b.createdAt) - new Date(a.response?.respondedAt || a.createdAt));
  return items;
}

function authorize(req) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const hdr = req.headers.authorization || '';
  return hdr === `Bearer ${expected}`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  if (!authorize(req)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('[weekly-digest] RESEND_API_KEY not set');
    return res.status(500).json({ ok: false, error: 'server_misconfigured' });
  }
  const r = getRedis();
  if (!r) {
    console.error('[weekly-digest] REDIS_URL not set');
    return res.status(500).json({ ok: false, error: 'storage_unavailable' });
  }

  const dry = String(req.query.dry || '') === '1';
  const limit = Math.max(0, parseInt(req.query.limit, 10) || 0);
  const from = process.env.RESEND_FROM || 'MyGrind <onboarding@resend.dev>';
  const testRedirect = (process.env.WEEKLY_DIGEST_TEST_EMAIL || '').trim().toLowerCase();

  const resend = new Resend(apiKey);

  let parents = [];
  try {
    parents = await listAllParentEmails(r);
  } catch (e) {
    console.error('[weekly-digest] scan failed:', e.message);
    return res.status(500).json({ ok: false, error: 'scan_failed' });
  }

  if (limit > 0) parents = parents.slice(0, limit);

  console.log('[weekly-digest] start', { parents: parents.length, dry, testRedirect: testRedirect || null, from });

  const results = { sent: 0, skipped_empty: 0, skipped_optout: 0, failed: 0, errors: [] };

  for (const parentEmail of parents) {
    // Coach Young 2026-05-17: skip parents who clicked Unsubscribe in a
    // prior digest. Flag set by api/digest-unsubscribe.js. Permanent
    // until support manually deletes the Redis key.
    try {
      const optedOut = await r.exists('feedback:digest-optout:' + parentEmail);
      if (optedOut) {
        results.skipped_optout++;
        continue;
      }
    } catch (e) {
      // Fail open — if Redis can't check the flag, skip rather than risk
      // sending to someone who opted out. CAN-SPAM violations cost more
      // than a missed digest.
      results.skipped_optout++;
      results.errors.push({ parentEmail, stage: 'optout_check', message: e.message });
      continue;
    }

    let items = [];
    try {
      items = await loadResponsedItems(r, parentEmail);
    } catch (e) {
      results.failed++;
      results.errors.push({ parentEmail, stage: 'load', message: e.message });
      continue;
    }

    if (!items.length) {
      results.skipped_empty++;
      continue;
    }

    const parentName = items[0]?.parent?.name || '';
    const recipient = testRedirect || parentEmail;
    // Per-parent HMAC unsubscribe URL — rendered into both HTML + text
    // footers by buildDigest when this param is present.
    const unsubscribeUrl = buildUnsubscribeUrl(parentEmail);
    const { subject, html, text } = buildDigest({ parentEmail, parentName, items, unsubscribeUrl });

    if (dry) {
      console.log('[weekly-digest] DRY', { recipient, subject, items: items.length });
      results.sent++;
      continue;
    }

    try {
      const r2 = await resend.emails.send({
        from,
        to: [recipient],
        subject,
        html,
        text,
        // Tag for Resend dashboard filtering
        tags: [{ name: 'kind', value: 'weekly_digest' }],
      });
      if (r2?.error) {
        results.failed++;
        results.errors.push({ parentEmail, stage: 'send', message: r2.error.message || 'send_failed' });
      } else {
        results.sent++;
      }
    } catch (e) {
      results.failed++;
      results.errors.push({ parentEmail, stage: 'send', message: e.message });
    }
  }

  console.log('[weekly-digest] done', results);
  return res.status(200).json({ ok: true, scanned: parents.length, ...results });
}
