// ═══════════════════════════════════════════════════════════
// MyGrind — api/stripe-webhook.js (Phase 5 Step 2)
// ───────────────────────────────────────────────────────────
// Receives subscription/payment events from Stripe and updates
// our Redis subscription store so softball.html + signup.html
// dashboards can gate paid features.
//
// SECURITY: signature verification with STRIPE_WEBHOOK_SECRET is
// mandatory. Without it, anyone could fake a "subscription.created"
// event and grant themselves paid access. Verification uses the
// official stripe SDK constructEvent() — DO NOT skip it.
//
// Endpoint: POST https://www.mygrindapp.com/api/stripe-webhook
// Configured in Stripe dashboard at /webhooks → endpoint → events:
//   - checkout.session.completed
//   - customer.subscription.created
//   - customer.subscription.updated
//   - customer.subscription.deleted
//   - invoice.payment_failed
//
// Idempotency: Stripe may retry the same event multiple times.
// upsertSubscription() compares event.id to the last one stored
// per customer and skips duplicates.
// ═══════════════════════════════════════════════════════════

import Stripe from 'stripe';
import { upsertSubscription } from '../lib/subscription-store.js';

// Disable Vercel's automatic JSON body parser so we can verify the
// raw payload signature. Stripe signatures are computed over the
// EXACT bytes — re-stringified JSON breaks verification.
export const config = {
  api: { bodyParser: false }
};

// Map Stripe price IDs → human-readable plan labels.
// Source: ~/.claude memory/stripe_ids.md (reconciled with live payment links 2026-05-06).
// Keep this list in sync whenever Coach adds/changes prices in Stripe.
const PRICE_TO_PLAN = {
  'price_1TQTekPm4ermqky4w6cqMnzO': 'single_monthly',     // $9.99/mo  (prod_UPIFHJyfyTvBYy)
  'price_1TQTDYPm4ermqky4TXgbfwFT': 'single_annual',      // $99.99/yr (prod_UN6Zzcas4NKeak)
  'price_1TT68UPm4ermqky47QJZ8SnB': 'family_annual',      // $149.99/yr (prod_US08Tl9LglAWq7)
  'price_1TT69tPm4ermqky4CYkbQcEf': 'family_monthly',     // $14.99/mo (prod_US0A0CbUborFoY)
  'price_1TOMMQPm4ermqky4inbGt7sY': 'team_coach',         // $29.99/yr (prod_UN6Zzcas4NKeak)
  'price_1TOkRfPm4ermqky47OyyWvKB': 'team_sponsor',       // $300 one-time (prod_UNVSgGdklou5Jd)
};

function planForSubscription(subscription) {
  try {
    const item = subscription.items?.data?.[0];
    const priceId = item?.price?.id;
    return PRICE_TO_PLAN[priceId] || priceId || 'unknown';
  } catch (e) { return 'unknown'; }
}

// Vercel doesn't expose req as a Node Readable in all runtimes; this helper
// concatenates the raw body bytes regardless of how req is wired.
async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const stripeKey    = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripeKey || !webhookSecret) {
    console.error('[stripe-webhook] missing env vars');
    return res.status(500).json({ ok: false, error: 'server_misconfigured' });
  }
  const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20' });

  let event;
  try {
    const rawBody = await readRawBody(req);
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (e) {
    console.warn('[stripe-webhook] signature verification failed:', e.message);
    return res.status(400).json({ ok: false, error: 'invalid_signature' });
  }

  console.log('[stripe-webhook] event:', { id: event.id, type: event.type });

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        // Customer just paid — Stripe creates the subscription separately,
        // but we capture the email + customer ID here so we can match.
        const session = event.data.object;
        const email = session.customer_details?.email || session.customer_email;
        if (!email) {
          console.warn('[stripe-webhook] checkout.session.completed: no email on session', { sessionId: session.id, customerId: session.customer });
          break;
        }
        await upsertSubscription({
          email,
          customerId: session.customer,
          subscriptionId: session.subscription,
          status: session.payment_status === 'paid' ? 'active' : 'incomplete',
          plan: null, // filled in by the subsequent customer.subscription.created event
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          rawEventId: event.id,
        });
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        // Look up customer email — sub object has customer ID, not email
        let email = null;
        try {
          const customer = await stripe.customers.retrieve(sub.customer);
          email = customer.email;
        } catch (e) {
          console.warn('[stripe-webhook] customer.retrieve failed:', e.message);
        }
        if (!email) {
          console.warn('[stripe-webhook] subscription.created/updated: no email (customer likely deleted)', { customerId: sub.customer, subId: sub.id, type: event.type });
          break;
        }
        await upsertSubscription({
          email,
          customerId:        sub.customer,
          subscriptionId:    sub.id,
          status:            sub.status,
          plan:              planForSubscription(sub),
          currentPeriodEnd:  sub.current_period_end || null,
          cancelAtPeriodEnd: !!sub.cancel_at_period_end,
          rawEventId:        event.id,
        });
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        let email = null;
        try {
          const customer = await stripe.customers.retrieve(sub.customer);
          email = customer.email;
        } catch (e) { /* fall through */ }
        if (!email) {
          console.warn('[stripe-webhook] subscription.deleted: no email (customer likely deleted)', { customerId: sub.customer, subId: sub.id });
          break;
        }
        await upsertSubscription({
          email,
          customerId:        sub.customer,
          subscriptionId:    sub.id,
          status:            'canceled',
          plan:              planForSubscription(sub),
          currentPeriodEnd:  sub.current_period_end || null,
          cancelAtPeriodEnd: true,
          rawEventId:        event.id,
        });
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        let email = invoice.customer_email;
        if (!email && invoice.customer) {
          try {
            const customer = await stripe.customers.retrieve(invoice.customer);
            email = customer.email;
          } catch (e) { /* fall through */ }
        }
        if (!email) {
          console.warn('[stripe-webhook] invoice.payment_failed: no email', { invoiceId: invoice.id, customerId: invoice.customer });
          break;
        }
        // Don't overwrite plan info — just mark past_due so the app shows
        // a "your card failed" banner. Renewal recovery handles the rest.
        await upsertSubscription({
          email,
          customerId: invoice.customer,
          status:     'past_due',
          rawEventId: event.id,
        });
        break;
      }

      default:
        console.log('[stripe-webhook] ignoring event type:', event.type);
    }
  } catch (e) {
    console.error('[stripe-webhook] handler error:', e.message);
    // Return 200 anyway — Stripe retries 4xx/5xx, and we don't want to
    // spam our logs with retries on transient handler errors. Failure
    // is recorded in console.
    return res.status(200).json({ ok: false, error: 'handler_error', message: e.message });
  }

  return res.status(200).json({ ok: true, received: event.type });
}
