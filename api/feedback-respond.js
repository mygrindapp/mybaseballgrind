// ═══════════════════════════════════════════════════════════
// Phase 7b V1 — Coach submits their response from coach-reply.html.
// Validates the magic-link token, persists the response on the
// existing request record, then SMSes the player ("Coach replied,
// open MyGrind to see"). Parent's weekly-review dashboard card
// pulls this aggregated server-side, no per-response email yet
// (V1.5 ships the weekly digest).
// ═══════════════════════════════════════════════════════════

import twilio from 'twilio';
import crypto from 'crypto';
import { recordResponse, getRequest } from '../lib/feedback-store.js';

// Short-hash PII for Vercel logs (H3 — security audit 2026-05-18).
function piiHash(value) {
  if (!value) return 'none';
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 8);
}

const ALLOWED_ORIGINS = new Set([
  'https://www.mygrindapp.com',
  'https://mygrindapp.com',
]);

const DRY_RUN = process.env.SMS_DRY_RUN !== 'false';

function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function toE164(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return null;
}

function buildPlayerSms({ playerName, coachName, chips, comment }) {
  const headline = (chips && chips.length) ? chips[0].label : 'has new feedback';
  const note = comment ? ' "' + (comment.length > 100 ? comment.slice(0, 100) + '…' : comment) + '"' : '';
  return (
    'MyGrind: ' + (coachName || 'Your coach') + ' responded — ' + headline + '.' + note + '\n\n' +
    'Open the app: https://www.mygrindapp.com/softball.html'
  );
}

async function sendSms(toPhone, body) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;

  if (DRY_RUN) {
    // DRY_RUN log: hash player phone, omit full body (includes coach's
    // response chip + the player's first name). H3 — security audit
    // 2026-05-18.
    console.log('[feedback-respond DRY_RUN] Would SMS player:', { toHash: piiHash(toPhone), bodyLength: body.length });
    return { ok: true, dryRun: true };
  }
  if (!accountSid || !authToken || !fromNumber) return { ok: false, error: 'twilio_unconfigured' };
  try {
    const client = twilio(accountSid, authToken);
    const msg = await client.messages.create({ body, from: fromNumber, to: toPhone });
    return { ok: true, sid: msg.sid };
  } catch (e) {
    console.error('[feedback-respond] Twilio send failed:', e.message);
    return { ok: false, error: 'twilio_send_failed' };
  }
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const { id, token, chips, comment, coachDisplayName } = req.body || {};
  if (!id || !token) return res.status(400).json({ ok: false, error: 'missing_id_or_token' });
  if ((!chips || !chips.length) && !comment) {
    return res.status(400).json({ ok: false, error: 'no_response_content' });
  }

  // Validate + write the response onto the existing request record
  const result = await recordResponse(id, token, { chips, comment, coachDisplayName });
  if (!result.ok) {
    const status = result.error === 'not_found' ? 404
                 : result.error === 'bad_token' ? 403
                 : result.error === 'already_responded' ? 409
                 : 500;
    return res.status(status).json(result);
  }

  // Notify the player by SMS
  const record = result.record;
  let notifySent = false;
  let notifyChannel = 'none';
  const playerE164 = toE164(record.player.phone);
  if (playerE164) {
    const smsBody = buildPlayerSms({
      playerName: record.player.name,
      coachName:  record.response.coachDisplayName,
      chips:      record.response.chips,
      comment:    record.response.comment
    });
    const sms = await sendSms(playerE164, smsBody);
    if (sms.ok) { notifySent = true; notifyChannel = 'sms' + (sms.dryRun ? '-dryrun' : ''); }
  }

  return res.status(200).json({
    ok: true,
    id,
    notify: { sent: notifySent, channel: notifyChannel }
  });
}
