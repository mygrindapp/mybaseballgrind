// ═══════════════════════════════════════════════════════════
// MyGrind — api/digest-unsubscribe.js
// ───────────────────────────────────────────────────────────
// Parent opt-out endpoint for the weekly digest email.
// Coach Young 2026-05-17 — CAN-SPAM compliance + UX trust.
//
// Called when a parent clicks the "Unsubscribe" link in any
// digest email. Validates an HMAC token (tamper-proof — no
// one can unsubscribe anyone else by guessing emails), sets
// a Redis opt-out flag, returns a branded confirmation page.
//
// URL pattern:
//   /api/digest-unsubscribe?email=<encoded>&token=<HMAC>
//
// Token: first 16 hex chars of HMAC-SHA256(email.toLowerCase(),
// CRON_SECRET). Reuses CRON_SECRET so deployment doesn't need
// a new env var. The first 16 chars (8 bytes) is plenty for a
// non-secret-but-tamper-proof URL token.
//
// Redis schema:
//   feedback:digest-optout:<email> = "1"   (no TTL — permanent
//                                          until support reverses)
//
// V1 limitation: no self-serve re-subscribe. If parent wants
// back on, they email support — easy delete of the flag.
// V2 could add a re-subscribe link with a different action.
// ═══════════════════════════════════════════════════════════

import Redis from 'ioredis';
import crypto from 'crypto';

let redis = null;
function getRedis() {
  if (redis) return redis;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  redis = new Redis(url, { maxRetriesPerRequest: 2, enableReadyCheck: false });
  redis.on('error', (e) => console.error('[digest-unsubscribe] redis error:', e.message));
  return redis;
}

function expectedToken(email) {
  const secret = process.env.CRON_SECRET || '';
  return crypto.createHmac('sha256', secret)
    .update(email.toLowerCase().trim())
    .digest('hex')
    .slice(0, 16);
}

// Short-hash PII for Vercel logs (H3 — security audit 2026-05-18).
// CCPA + privacy hygiene — emails should not sit in cleartext in logs
// that any teammate with Vercel project access can read. 8-char SHA-256
// prefix is short enough to grep across logs but irreversible.
function piiHash(value) {
  if (!value) return 'none';
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 8);
}

// Brand-matched confirmation page (same warm-dark palette as the digest itself
// so the parent recognizes the page as MyGrind, not a phishing site).
function htmlPage({ ok, email, message }) {
  const C = {
    bg: '#1A1410', surface: '#221813', border: '#3a2a1f',
    gold: '#D4A574', cream: '#F5EDE0', mute: '#9a8b78',
  };
  const safeEmail = String(email || '').replace(/[<>"&']/g, '');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${ok ? 'Unsubscribed · MyGrind' : 'MyGrind'}</title>
</head>
<body style="margin:0;padding:48px 24px;background:${C.bg};color:${C.cream};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;text-align:center;min-height:100vh;box-sizing:border-box;">
  <div style="max-width:480px;margin:0 auto;background:${C.surface};border:1px solid ${C.border};border-radius:12px;padding:32px 24px;">
    <div style="font-size:48px;line-height:1;margin-bottom:16px;">${ok ? '✅' : '⚠️'}</div>
    <h1 style="margin:0 0 12px;color:${C.cream};font-size:22px;font-weight:600;">${ok ? "You're unsubscribed" : "Unsubscribe link is invalid"}</h1>
    <p style="margin:0 0 20px;color:${C.mute};font-size:15px;line-height:1.6;">${message}</p>
    ${ok && safeEmail ? `<p style="margin:0 0 20px;color:${C.gold};font-size:14px;word-break:break-all;">${safeEmail}</p>` : ''}
    <p style="margin:24px 0 0;color:${C.mute};font-size:13px;line-height:1.6;">
      Need to re-enable, or have questions?<br>
      Email <a href="mailto:support@mygrindapp.com" style="color:${C.gold};">support@mygrindapp.com</a>.
    </p>
  </div>
</body>
</html>`;
}

function sendHtml(res, status, body) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).send(body);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).send('Method not allowed');
  }

  const email = String(req.query.email || '').toLowerCase().trim();
  const token = String(req.query.token || '').trim();

  if (!email || !token) {
    return sendHtml(res, 400, htmlPage({
      ok: false,
      message: 'This unsubscribe link is missing required parameters. The link may have been truncated in your email client. Email support and we will turn off the digest manually.',
    }));
  }

  const expected = expectedToken(email);
  if (token !== expected) {
    return sendHtml(res, 403, htmlPage({
      ok: false,
      message: 'This unsubscribe link could not be verified. It may have been altered in transit or it may be from an old email. Email support and we will turn off the digest manually.',
    }));
  }

  const r = getRedis();
  if (!r) {
    console.error('[digest-unsubscribe] REDIS_URL not set');
    return sendHtml(res, 500, htmlPage({
      ok: false,
      message: 'Our system had a temporary issue processing your unsubscribe. Try again in a few minutes, or email support and we will turn off the digest manually.',
    }));
  }

  try {
    await r.set('feedback:digest-optout:' + email, '1');
    console.log('[digest-unsubscribe] opted out:', { emailHash: piiHash(email) });
    return sendHtml(res, 200, htmlPage({
      ok: true,
      email,
      message: "You won't receive the MyGrind weekly digest anymore. Existing app access (logins, player journals) is unaffected — this only stops the Monday morning email.",
    }));
  } catch (e) {
    console.error('[digest-unsubscribe] redis write failed:', e.message);
    return sendHtml(res, 500, htmlPage({
      ok: false,
      message: 'Our system had a temporary issue. Try again in a few minutes, or email support.',
    }));
  }
}
