// ═══════════════════════════════════════════════════════════
// Phase 7b V1 — Player submits a feedback request to a coach.
// Stores it in Redis, then sends an SMS magic link to the coach.
// SMS falls back to the email path automatically when Twilio is
// in DRY_RUN mode (TFV not yet approved) — magic link still gets
// generated and persisted, so the player's outbox stays accurate.
// ═══════════════════════════════════════════════════════════

import twilio from 'twilio';
import crypto from 'crypto';
import { createRequest } from '../lib/feedback-store.js';
import { checkIpLimit, checkPhoneLimit, recordSend } from '../lib/rate-limit.js';
import { verifyBearer } from '../lib/firebase-admin.js';

// ─── Extract real client IP from Vercel proxy headers ─────
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers['x-real-ip'] || null;
}

// ─── Short-hash for PII-safe logs (Decision: never log raw email/phone) ─
function piiHash(value) {
  if (!value) return 'none';
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 8);
}

const ALLOWED_ORIGINS = new Set([
  'https://www.mygrindapp.com',
  'https://mygrindapp.com',
]);

const DRY_RUN = process.env.SMS_DRY_RUN !== 'false';
const APP_BASE = 'https://www.mygrindapp.com';

function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function buildCoachSms({ playerName, focus, situation, note, link }) {
  // Keep under 320 chars so it stays as a single GSM-7 segment
  const trimmedNote = note.length > 80 ? note.slice(0, 80) + '…' : note;
  return (
    'MyGrind: ' + playerName + ' has a question (' + focus + ' / ' + situation + ').\n\n' +
    '"' + trimmedNote + '"\n\n' +
    'Tap to respond: ' + link
  );
}

async function sendSmsViaTwilio(toPhone, body) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;

  if (DRY_RUN) {
    // DRY_RUN log: hash coach phone, omit full body (includes magic-link
    // token in URL which grants response access for 90 days). H3 —
    // security audit 2026-05-18.
    console.log('[feedback-request DRY_RUN] Would SMS coach:', { toHash: piiHash(toPhone), bodyLength: body.length });
    return { ok: true, dryRun: true };
  }
  if (!accountSid || !authToken || !fromNumber) {
    console.error('[feedback-request] Missing Twilio env vars');
    return { ok: false, error: 'twilio_unconfigured' };
  }
  try {
    const client = twilio(accountSid, authToken);
    const msg = await client.messages.create({ body, from: fromNumber, to: toPhone });
    return { ok: true, sid: msg.sid };
  } catch (e) {
    console.error('[feedback-request] Twilio send failed:', e.message);
    return { ok: false, error: 'twilio_send_failed' };
  }
}

function toE164(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return null;
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  // ── Authentication (2026-07-02 hardening, audit M3) ─────────────────
  // Before this, ANYONE could make MyGrind deliver attacker-written text
  // (SMS once live, email today) to an arbitrary coach phone/email — an
  // SMS-injection / harassment vector with MyGrind's name on it. A
  // feedback request now requires a signed-in account (the parent's
  // Firebase session). softball.html sends the bearer and shows a
  // sign-in prompt on 401.
  const auth = await verifyBearer(req);
  if (!auth.ok) {
    return res.status(401).json({ ok: false, error: 'auth_required' });
  }

  const body = req.body || {};
  const { playerName, playerPhone, parentName, parentEmail,
          coachName, coachEmail, coachPhone,
          focus, situation, note, sport } = body;

  if (!playerName || !coachName || !focus || !situation || !note) {
    return res.status(400).json({ ok: false, error: 'missing_fields' });
  }
  if (!coachEmail && !coachPhone) {
    return res.status(400).json({ ok: false, error: 'coach_contact_required' });
  }

  // ─── Rate limiting (H2 — security audit 2026-05-18) ──────
  // Per-IP limit (3/hr, 10/day) prevents endpoint flood.
  // Per-coach-phone limit (2/24h) prevents weaponized SMS spam
  // to a single coach number once Twilio TFV approves. Reuses
  // the same Redis-backed limiter pattern as invite-send.js. Fail-open
  // on Redis outage by design — legit feedback flow keeps working
  // during a Redis blip rather than blocking everyone.
  const clientIp = getClientIp(req);
  const ipCheck = await checkIpLimit(clientIp);
  if (!ipCheck.ok) {
    console.warn('[feedback-request] IP rate limited', { ipHash: piiHash(clientIp), reason: ipCheck.reason });
    return res.status(429).json({ ok: false, error: 'rate_limited' });
  }

  // Coach-phone bucket (only if we have a phone to rate-limit against).
  // We use the COACH's phone as the rate-limit key here, not the player's,
  // because the abuse pattern is "send 50 harassing SMS to coach X" —
  // which would be invisible to a player-keyed limiter.
  if (coachPhone) {
    const digits = String(coachPhone).replace(/\D/g, '');
    const coachE164 = digits.length === 10 ? '+1' + digits
                    : (digits.length === 11 && digits.startsWith('1')) ? '+' + digits
                    : null;
    if (coachE164) {
      const phoneCheck = await checkPhoneLimit(coachE164);
      if (!phoneCheck.ok) {
        console.warn('[feedback-request] Coach phone rate limited', { coachPhoneHash: piiHash(coachE164), reason: phoneCheck.reason });
        return res.status(429).json({ ok: false, error: 'rate_limited' });
      }
      // Record the attempt against IP + coach phone BEFORE we write Redis
      // or call Twilio. Matches the invite-send.js Option C architecture:
      // protects against bursts even when downstream services misbehave.
      await recordSend(clientIp, coachE164);
    } else {
      // Coach phone is malformed but not empty — record IP only so this
      // path still costs against the IP budget. Don't reject yet; the
      // record will still be created (player may have intended email).
      await recordSend(clientIp, null);
    }
  } else {
    // Email-only flow (no coach phone) — still record IP cost.
    await recordSend(clientIp, null);
  }

  const created = await createRequest({
    playerName, playerPhone, parentName, parentEmail,
    coachName, coachEmail, coachPhone,
    focus, situation, note: String(note).slice(0, 280), sport
  });
  if (!created.ok) return res.status(500).json(created);

  const link = APP_BASE + '/coach-reply.html?req=' + created.id + '&t=' + created.token;
  const smsBody = buildCoachSms({ playerName, focus, situation, note, link });

  // SMS first if we have a coach phone
  let notifySent = false;
  let notifyChannel = 'none';
  const coachE164 = toE164(coachPhone);
  if (coachE164) {
    const sms = await sendSmsViaTwilio(coachE164, smsBody);
    if (sms.ok) { notifySent = true; notifyChannel = 'sms' + (sms.dryRun ? '-dryrun' : ''); }
  }

  // No fallback delivery in V1 server-side — if no SMS, the player's app
  // shows them the magic link to share manually with the coach. Email
  // fanout for V1.5 will plug in here without changing the API surface.

  return res.status(200).json({
    ok: true,
    id: created.id,
    link,
    notify: { sent: notifySent, channel: notifyChannel }
  });
}
