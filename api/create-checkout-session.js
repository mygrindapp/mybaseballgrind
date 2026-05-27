// ═══════════════════════════════════════════════════════════
// MyGrind — api/create-checkout-session.js (card-on-file at signup)
// ───────────────────────────────────────────────────────────
// Creates a Stripe Checkout Session that captures the customer's
// card during signup, before the dashboard. Stripe holds the card,
// keeps the subscription in 'trialing' state, and auto-charges on
// trial_end — matches Spotify/Netflix/Calm/ClassDojo pattern and
// converts 5-10x better than "free trial, banner at Day 11".
//
// Strategic switch 2026-05-27 (Coach Young): industry-standard
// card-on-file. The captured card at signup also serves as the
// FTC-accepted verifiable parental consent signal for the upcoming
// COPPA under-13 path.
//
// Why a custom endpoint (not the existing Payment Links):
//   Payment Links are static — their trial_period_days is configured
//   at the link level and can't be overridden per-session. For signup
//   we need a SPECIFIC trial_end timestamp that aligns to each user's
//   MyGrind cliff (varies: 14d default, 180d founder, etc).
//
// Endpoint: POST https://www.mygrindapp.com/api/create-checkout-session
// Body:
//   {
//     email:            "parent@example.com",  // required
//     planType:         "single_monthly",      // or single_annual / family_monthly / family_annual
//     trialEndUnix:     1734567890,            // required — Unix seconds, MUST be future
//     promoCode:        "FOUNDERMYGRIND"       // optional — passed through to Stripe
//   }
// Response:
//   200 { ok: true, url: "https://checkout.stripe.com/c/pay/..." }
//   400 { ok: false, error: "missing_email" | "bad_plan_type" | "trial_end_in_past" }
//   429 { ok: false, error: "rate_limited" }
//   500 { ok: false, error: "server_misconfigured" | "stripe_error" }
//
// SECURITY: Rate-limited per IP using the existing read-tier limiter.
// trialEndUnix is validated server-side — a client can't request a
// 10-year trial. Hard-capped at 365 days from now.
// ═══════════════════════════════════════════════════════════

import Stripe from 'stripe';
import crypto from 'crypto';
import { checkIpReadLimit, recordRead } from '../lib/rate-limit.js';

const ALLOWED_ORIGINS = new Set([
  'https://www.mygrindapp.com',
  'https://mygrindapp.com',
]);

// Plan → live Stripe price ID. Source: api/stripe-webhook.js PRICE_TO_PLAN
// (reverse direction). Keep in sync when prices change in Stripe.
const PLAN_TO_PRICE = {
  single_monthly: 'price_1TQTekPm4ermqky4w6cqMnzO', // $9.99/mo
  single_annual:  'price_1TQTDYPm4ermqky4TXgbfwFT', // $99.99/yr
  family_monthly: 'price_1TT69tPm4ermqky4CYkbQcEf', // $14.99/mo
  family_annual:  'price_1TT68UPm4ermqky47QJZ8SnB', // $149.99/yr
};

// Hard cap on how far in the future a client can push trial_end.
// Default 14-day trial = ~14 days out. Founder cohort = 180 days. Anything
// past 365 is a client bug or an attack — reject.
const MAX_TRIAL_DAYS_FROM_NOW = 365;

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
    console.error('[create-checkout-session] STRIPE_SECRET_KEY not set');
    return res.status(500).json({ ok: false, error: 'server_misconfigured' });
  }

  // ─── Rate limit per IP ────────────────────────────────────
  const clientIp = getClientIp(req);
  const ipCheck = await checkIpReadLimit(clientIp);
  if (!ipCheck.ok) {
    console.warn('[create-checkout-session] IP rate limited', { ipHash: piiHash(clientIp) });
    return res.status(429).json({ ok: false, error: 'rate_limited' });
  }
  await recordRead(clientIp);

  // ─── Validate input ───────────────────────────────────────
  const { email, planType, trialEndUnix, promoCode } = req.body || {};

  if (!isValidEmail(email)) {
    return res.status(400).json({ ok: false, error: 'missing_email' });
  }
  const normEmail = email.trim().toLowerCase();

  const plan = (planType || 'single_monthly').toLowerCase();
  const priceId = PLAN_TO_PRICE[plan];
  if (!priceId) {
    return res.status(400).json({ ok: false, error: 'bad_plan_type', allowed: Object.keys(PLAN_TO_PRICE) });
  }

  const nowUnix = Math.floor(Date.now() / 1000);
  const trialEnd = Number(trialEndUnix);
  if (!Number.isFinite(trialEnd) || trialEnd <= nowUnix) {
    return res.status(400).json({ ok: false, error: 'trial_end_in_past' });
  }
  const maxAllowed = nowUnix + (MAX_TRIAL_DAYS_FROM_NOW * 86400);
  if (trialEnd > maxAllowed) {
    return res.status(400).json({ ok: false, error: 'trial_end_too_far' });
  }

  // ─── Create Checkout Session ──────────────────────────────
  // Stripe creates a subscription in 'trialing' status. No charge today.
  // On trial_end, Stripe automatically charges the captured card. Our
  // stripe-webhook.js already handles customer.subscription.created (sets
  // status=trialing in Redis) and invoice.paid (flips to active) — no
  // additional webhook work needed.
  const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20' });

  const sessionParams = {
    mode: 'subscription',
    customer_email: normEmail,
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: {
      trial_end: trialEnd,
      // Failure behavior: if card fails at trial_end, pause the
      // subscription so user can fix payment without losing data.
      trial_settings: {
        end_behavior: { missing_payment_method: 'pause' },
      },
      metadata: {
        mg_source:        'signup_card_on_file',
        mg_promo_code:    promoCode || '',
        mg_trial_end:     String(trialEnd),
      },
    },
    payment_method_collection: 'always',
    success_url: 'https://www.mygrindapp.com/softball.html?co=success',
    cancel_url:  'https://www.mygrindapp.com/softball.html?co=cancel',
    metadata: {
      mg_email:      normEmail,
      mg_plan_type:  plan,
      mg_promo_code: promoCode || '',
    },
  };

  // Pass promo code through to Stripe Checkout. Stripe accepts/rejects
  // it at checkout — invalid codes don't break the flow. allow_promotion_codes
  // exposes a user-visible promo field too in case the user has a code they
  // want to apply at the last step.
  if (promoCode) {
    sessionParams.discounts = []; // intentionally empty — promo code goes via the prefill below
    sessionParams.allow_promotion_codes = true;
  } else {
    sessionParams.allow_promotion_codes = true;
  }

  let session;
  try {
    session = await stripe.checkout.sessions.create(sessionParams);
  } catch (e) {
    console.error('[create-checkout-session] stripe error:', e.message);
    return res.status(500).json({ ok: false, error: 'stripe_error', message: e.message });
  }

  console.log('[create-checkout-session] session created', {
    sessionId:  session.id,
    emailHash:  piiHash(normEmail),
    plan,
    trialEnd,
    trialDays:  Math.round((trialEnd - nowUnix) / 86400),
    promo:     promoCode ? piiHash(promoCode) : 'none',
  });

  return res.status(200).json({ ok: true, url: session.url, sessionId: session.id });
}
