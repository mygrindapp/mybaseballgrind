// ═══════════════════════════════════════════════════════════
// MyGrind — api/invite-send.js (2026-06-10)
// ───────────────────────────────────────────────────────────
// Unified player-invite delivery for the Screen 7 / dashboard
// "Send the setup link" modal. One endpoint, two channels:
//
//   - SMS  via Twilio (toll-free verified 2026-06)
//   - Email via Resend (same branded template family as
//     api/magic-link-request.js)
//
// The server auto-detects the channel from the destination
// string: contains "@" → email, otherwise phone.
//
// WHY A NEW ENDPOINT instead of reusing api/send-invite.js:
// send-invite.js gates on trial eligibility and 409s when the
// parent's email is already recorded as trial-used. That is
// correct for first-signup, but this endpoint serves PAID
// parents re-sending or choosing a channel AFTER signup, where
// the parent's email is always already recorded. No trial
// gating here, and no recordTrialUsed — /api/start-trial owns
// that bookkeeping.
//
// Endpoint: POST /api/invite-send
// Body:    { destination, playerName, sport, parentName, parentEmail? }
// Response:
//   200 { success: true, channel: 'sms'|'email', sentAt }
//   400 { success: false, error }  — bad input / bad phone line
//   429 { success: false, error, code: 'RATE_LIMITED' }
//   503 { success: false, error, code: 'SMS_NOT_LIVE' } — SMS dry-run
//   500 { success: false, error }
//
// Abuse posture: per-IP send limits (3/hr, 10/day) + per-
// destination daily limit (2/24h) via lib/rate-limit.js. The
// destination limiter hashes any string, so it covers email
// addresses the same way it covers phones. Twilio Lookup
// pre-checks SMS numbers before a paid send. Fail-open on
// Redis/Lookup outages matches every other endpoint.
//
// PII: destinations are short-hashed in logs (H3, 2026-05-18).
// ═══════════════════════════════════════════════════════════

import twilio from 'twilio';
import crypto from 'crypto';
import { Resend } from 'resend';
import { checkIpLimit, checkPhoneLimit, recordSend } from '../lib/rate-limit.js';
import { lookupPhone } from '../lib/lookup.js';
import { getSubscription } from '../lib/subscription-store.js';

const DRY_RUN = process.env.SMS_DRY_RUN !== 'false';

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

function piiHash(value) {
  if (!value) return 'none';
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 8);
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers['x-real-ip'] || null;
}

function toE164(phone) {
  if (!phone || typeof phone !== 'string') return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

function isValidEmail(e) {
  return typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
}

function trimStr(v, max) {
  return (typeof v === 'string' ? v : '').trim().slice(0, max);
}

// ─── Shared invite URL builder ────────────────────────────
// Must stay in lockstep with signup.html openInviteShareModal()
// and api/send-invite.js buildSmsBody().
function buildInviteUrl(playerName, sport, famPaid) {
  return 'https://mygrindapp.com/onboarding.html'
    + '?name='  + encodeURIComponent(playerName)
    + '&sport=' + encodeURIComponent(sport)
    // fam=1: this invite comes from a household with an active/trialing
    // subscription (server-verified in the handler). onboarding.html stamps
    // the kid's device with mg_dep_of_paid so softball.html never shows the
    // kid a trial countdown or the day-30 lockout — billing pressure
    // belongs on the payer's surfaces, not a paid family's player.
    + (famPaid ? '&fam=1' : '');
}

function sportLabel(sport) {
  if (sport === 'softball') return 'softball';
  if (sport === 'both')     return 'baseball/softball';
  return 'baseball';
}

// ─── SMS body ─────────────────────────────────────────────
// GSM-7 only (plain hyphen, straight apostrophes) so segments
// stay at 153 chars. Mirrors send-invite.js voice.
function buildSmsBody({ parentName, playerName, sport, famPaid }) {
  const url = buildInviteUrl(playerName, sport, famPaid);
  return (
    `Hey ${playerName}, ${parentName} signed you up for MyGrind - ` +
    `the ${sportLabel(sport)} journal for tracking your stats, games, and growth.\n\n` +
    `Set up your profile (3 min): ${url}`
  );
}

// ─── Email body ───────────────────────────────────────────
// Warm-dark branded HTML matching api/magic-link-request.js so
// the brand reads consistent inbox to inbox.
function buildEmailParts({ parentName, playerName, sport, famPaid }) {
  const url   = buildInviteUrl(playerName, sport, famPaid);
  const label = sportLabel(sport);

  const text = [
    `Hey ${playerName},`,
    '',
    `${parentName} signed you up for MyGrind - the ${label} journal for tracking your stats, games, and growth.`,
    '',
    `Set up your profile (about 3 minutes): ${url}`,
    '',
    'Coach',
    'The Grind',
  ].join('\n');

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0; padding:0; background:#0E0006; font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif; color:#F2EAD9;">
  <div style="max-width:560px; margin:0 auto; padding:32px 24px;">
    <div style="font-family:'Bebas Neue',sans-serif; font-size:28px; letter-spacing:2px; color:#E8C97A; margin-bottom:8px;">MY GRIND</div>
    <div style="height:2px; background:#B89A4B; width:64px; margin-bottom:28px;"></div>

    <p style="font-size:16px; line-height:1.6; color:#F2EAD9; margin:0 0 18px;">Hey ${playerName},</p>

    <p style="font-size:16px; line-height:1.6; color:#F2EAD9; margin:0 0 24px;">
      <strong style="color:#E8C97A;">${parentName}</strong> signed you up for MyGrind - the ${label} journal for tracking your stats, games, and growth.
    </p>

    <div style="text-align:center; margin:0 0 28px;">
      <a href="${url}" style="display:inline-block; background:#E8C97A; color:#080808; font-family:'Barlow Condensed',sans-serif; font-size:13px; font-weight:800; letter-spacing:2px; text-transform:uppercase; padding:16px 28px; border-radius:8px; text-decoration:none;">Start My Setup (3 min) →</a>
    </div>

    <p style="font-size:13px; line-height:1.6; color:#9F9486; margin:0 0 18px;">
      Or copy this link into your browser:<br>
      <a href="${url}" style="color:#E8C97A; text-decoration:none; word-break:break-all;">${url}</a>
    </p>

    <div style="background:rgba(184,154,75,0.06); border:1px solid #B89A4B; border-radius:6px; padding:14px 16px; margin-bottom:28px;">
      <p style="font-size:13px; line-height:1.6; color:#F2EAD9; margin:0;">
        <strong style="color:#E8C97A;">Not expecting this?</strong> ${parentName} entered this address when setting up a player account. If that's not you, just ignore this email.
      </p>
    </div>

    <p style="font-size:14px; line-height:1.6; color:#9F9486; margin:0;">Coach<br>The Grind</p>
  </div>
</body></html>`;

  return { text, html };
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  // ─── Input validation ────────────────────────────────────
  const body        = req.body || {};
  const destination = trimStr(body.destination, 254);
  const playerName  = trimStr(body.playerName, 60);
  const sportRaw    = trimStr(body.sport, 16).toLowerCase();
  const parentName  = trimStr(body.parentName, 60) || 'Your parent';
  const parentEmail = trimStr(body.parentEmail, 254); // logging + family-paid lookup

  // Family-paid stamp: if the parent's email holds an active/trialing
  // subscription, the invite link carries fam=1 (see buildInviteUrl).
  // Server-truth read of the existing store; never returned to the caller,
  // it only rides inside the SMS/email that goes to the family's player.
  let famPaid = false;
  if (isValidEmail(parentEmail)) {
    try {
      const sub = await getSubscription(parentEmail);
      famPaid = !!(sub && sub.isPaid);
    } catch (e) { /* store unavailable — send the plain link */ }
  }

  const sport = (sportRaw === 'softball' || sportRaw === 'both') ? sportRaw : 'baseball';

  if (!destination || !playerName) {
    console.warn('[invite-send] Bad request', {
      hasDest: !!destination, hasName: !!playerName,
    });
    return res.status(400).json({ success: false, error: 'Bad request' });
  }

  const channel = destination.includes('@') ? 'email' : 'sms';

  // ─── Per-channel destination validation ──────────────────
  let destKey; // the string we rate-limit on
  let e164Phone = null;

  if (channel === 'email') {
    if (!isValidEmail(destination)) {
      return res.status(400).json({
        success: false,
        error: "That email doesn't look right - check it and try again.",
      });
    }
    destKey = destination.toLowerCase();
  } else {
    e164Phone = toE164(destination);
    if (!e164Phone) {
      return res.status(400).json({
        success: false,
        error: 'Enter a 10-digit US phone number or an email address.',
      });
    }
    destKey = e164Phone;
  }

  // ─── Rate limits (shared budget with send-invite) ────────
  const clientIp = getClientIp(req);

  const ipCheck = await checkIpLimit(clientIp);
  if (!ipCheck.ok) {
    console.warn('[invite-send] IP rate limited', { reason: ipCheck.reason });
    return res.status(429).json({
      success: false,
      error: 'Too many requests, try again later',
      code: 'RATE_LIMITED',
    });
  }

  const destCheck = await checkPhoneLimit(destKey); // hashes any string; "destination daily" here
  if (!destCheck.ok) {
    console.warn('[invite-send] Destination rate limited', {
      destHash: piiHash(destKey), channel,
    });
    return res.status(429).json({
      success: false,
      error: 'Too many requests, try again later',
      code: 'RATE_LIMITED',
    });
  }

  // Count the attempt now (Option C: protects even when the
  // provider misbehaves; counters mean "attempted sends").
  await recordSend(clientIp, destKey);

  // ═══ EMAIL CHANNEL ═══════════════════════════════════════
  if (channel === 'email') {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.error('[invite-send] Missing RESEND_API_KEY');
      return res.status(500).json({ success: false, error: 'Server misconfigured' });
    }

    try {
      const resend = new Resend(apiKey);
      const from   = process.env.RESEND_FROM || 'MyGrind <coach@mygrindapp.com>';
      const parts  = buildEmailParts({ parentName, playerName, sport, famPaid });

      const result = await resend.emails.send({
        from,
        to: destKey,
        subject: `${playerName}, your MyGrind setup link is here`,
        html: parts.html,
        text: parts.text,
        replyTo: 'coach@mygrindapp.com',
      });

      if (result && result.error) {
        console.error('[invite-send] Resend error:', result.error.message || result.error);
        return res.status(500).json({ success: false, error: 'Could not send invite', code: 'SEND_FAILED' });
      }

      console.log('[invite-send] Email sent', {
        toHash: piiHash(destKey),
        parentHash: piiHash(parentEmail),
        id: result && result.data && result.data.id,
      });

      return res.status(200).json({
        success: true,
        channel: 'email',
        sentAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[invite-send] Email send failed:', err.message);
      return res.status(500).json({ success: false, error: 'Could not send invite', code: 'SEND_FAILED' });
    }
  }

  // ═══ SMS CHANNEL ═════════════════════════════════════════

  // Twilio Lookup pre-check: catch landlines / VoIP / invalid
  // numbers BEFORE a paid send. Fail-open on Lookup outage.
  const lookup = await lookupPhone(e164Phone);
  if (!lookup.ok) {
    console.warn('[invite-send] Lookup rejected number', { reason: lookup.reason });
    return res.status(400).json({
      success: false,
      error: lookup.message || 'That phone number cannot receive text invites.',
      code: 'INVALID_PHONE_LINE',
    });
  }

  // Honest dry-run: until SMS_DRY_RUN=false is set in Vercel,
  // tell the parent the truth instead of pretending a text went
  // out. Email + copy-link keep working in the meantime.
  if (DRY_RUN) {
    console.log('[invite-send DRY_RUN] Would send SMS', {
      toHash: piiHash(e164Phone),
    });
    return res.status(503).json({
      success: false,
      error: 'Text invites are not switched on yet - email it or copy the link for now.',
      code: 'SMS_NOT_LIVE',
    });
  }

  try {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken  = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_FROM_NUMBER;

    if (!accountSid || !authToken || !fromNumber) {
      console.error('[invite-send] Missing Twilio env vars');
      return res.status(500).json({ success: false, error: 'Server misconfigured' });
    }

    const client  = twilio(accountSid, authToken);
    const message = await client.messages.create({
      body: buildSmsBody({ parentName, playerName, sport, famPaid }),
      from: fromNumber,
      to:   e164Phone,
    });

    console.log('[invite-send] SMS sent', {
      smsSid: message.sid,
      toHash: piiHash(e164Phone),
      parentHash: piiHash(parentEmail),
    });

    return res.status(200).json({
      success: true,
      channel: 'sms',
      sentAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[invite-send] Twilio error:', {
      code: err.code, message: err.message, status: err.status,
    });
    return res.status(500).json({ success: false, error: 'Could not send invite', code: 'SEND_FAILED' });
  }
}
