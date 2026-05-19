// ═══════════════════════════════════════════════════════════
// MyGrind — api/stripe-portal-session.js (one-click billing portal)
// ───────────────────────────────────────────────────────────
// Creates a one-time Stripe Customer Portal session for the currently
// signed-in user. Returns the portal URL — the client redirects the
// browser to it. Inside the portal, the user can update their card,
// change plan, see invoices, or cancel — all on Stripe's hosted UI.
//
// Replaces the previous "Stripe-hosted login link" UX which required
// the user to enter their email + verify a one-time code at Stripe
// every visit. Since softball.html already knows the user (Firebase
// Auth or local ybg_access.email), we can resolve their Stripe
// customerId from Redis and create a fully-authenticated session in
// one shot.
//
// Endpoint: POST /api/stripe-portal-session
// Body:    { email }
// Response:
//   200 { ok: true, url: "https://billing.stripe.com/session/..." }
//   400 { ok: false, error: 'missing_email' | 'invalid_email' }
//   404 { ok: false, error: 'no_customer' }  — email has no Redis sub record
//   429 { ok: false, error: 'rate_limited' }
//   500 { ok: false, error: 'server_misconfigured' | 'stripe_error' }
//
// Security:
//   - Per-IP rate limited via existing read-tier limiter.
//   - No customerId leaks to the client — we resolve it server-side.
//   - The portal session URL is short-lived (Stripe expires it on use
//     OR after ~5 min idle). Even if intercepted in transit, value is
//     limited to that window.
//   - Email-enumeration concern is small here (subscription state isn't
//     particularly sensitive to leak), but we still return generic 404
//     for non-existent customers vs distinguishing "valid email no sub"
//     vs "invalid email."
// ═══════════════════════════════════════════════════════════

import Stripe from 'stripe';
import crypto from 'crypto';
import { getSubscription } from '../lib/subscription-store.js';
import { checkIpReadLimit, recordRead } from '../lib/rate-limit.js';

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

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers['x-real-ip'] || null;
}

function piiHash(value) {
  if (!value) return 'none';
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 8);
}

function isValidEmail(e) {
  return typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    console.error('[stripe-portal-session] STRIPE_SECRET_KEY not set');
    return res.status(500).json({ ok: false, error: 'server_misconfigured' });
  }

  // Per-IP rate limit
  const clientIp = getClientIp(req);
  const ipCheck = await checkIpReadLimit(clientIp);
  if (!ipCheck.ok) {
    console.warn('[stripe-portal-session] IP rate limited', { ipHash: piiHash(clientIp) });
    return res.status(429).json({ ok: false, error: 'rate_limited' });
  }
  await recordRead(clientIp);

  const { email } = req.body || {};
  if (!email) return res.status(400).json({ ok: false, error: 'missing_email' });
  if (!isValidEmail(email)) return res.status(400).json({ ok: false, error: 'invalid_email' });
  const normEmail = email.trim().toLowerCase();

  // Resolve Stripe customerId from our Redis sub:<email> record. Set by
  // stripe-webhook.js on checkout.session.completed and customer.subscription.*
  // events. Users who completed a real signup-to-pay flow have it; trial-only
  // users (no payment yet) won't have a customerId and we can't open a portal
  // for them.
  const sub = await getSubscription(normEmail);
  if (!sub || !sub.ok || !sub.record || !sub.record.customerId) {
    console.log('[stripe-portal-session] no customer record', { emailHash: piiHash(normEmail) });
    return res.status(404).json({ ok: false, error: 'no_customer' });
  }

  const customerId = sub.record.customerId;
  const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20' });

  let session;
  try {
    session = await stripe.billingPortal.sessions.create({
      customer:    customerId,
      return_url:  'https://www.mygrindapp.com/softball.html',
    });
  } catch (e) {
    console.error('[stripe-portal-session] stripe error:', e.message);
    return res.status(500).json({ ok: false, error: 'stripe_error', message: e.message });
  }

  console.log('[stripe-portal-session] session created', {
    emailHash:    piiHash(normEmail),
    customerHash: piiHash(customerId),
    sessionId:    session.id,
  });

  return res.status(200).json({ ok: true, url: session.url });
}
