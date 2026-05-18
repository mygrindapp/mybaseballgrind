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
import { Resend } from 'resend';
import crypto from 'crypto';
import { upsertSubscription } from '../lib/subscription-store.js';

// Short-hash PII for Vercel logs (H3 — security audit 2026-05-18).
// Email and customer-id stay greppable across log entries (same email
// always hashes to the same prefix) without sitting in cleartext where
// any teammate with Vercel project access can read them.
function piiHash(value) {
  if (!value) return 'none';
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 8);
}

// ─── CANCELLATION EMAIL ────────────────────────────────────
// Closes the loop on the cancellation policy promised in Settings on
// softball.html: "The billing email on file gets the cancellation
// confirmation by email." Without this, the policy promise was a lie:
// the webhook updated Redis but no email ever went out. Coach Young
// 2026-05-18.
//
// Fires on customer.subscription.deleted (terminal cancel event from
// Stripe — covers both immediate cancels and cancel-at-period-end after
// the period actually ends). Failure to send NEVER fails the webhook;
// Stripe's Redis-source-of-truth state must succeed regardless of email.
//
// Test-mode redirect: reuses WEEKLY_DIGEST_TEST_EMAIL so during DNS
// pre-verification, all transactional emails route to one inbox.
async function sendCancellationEmail({ email, currentPeriodEndUnix, plan }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[stripe-webhook] cancel email skipped: RESEND_API_KEY not set');
    return { ok: false, reason: 'no_api_key' };
  }
  if (!email) {
    console.warn('[stripe-webhook] cancel email skipped: no recipient email');
    return { ok: false, reason: 'no_email' };
  }

  const from        = process.env.RESEND_FROM || 'MyGrind <onboarding@resend.dev>';
  const testRedirect = process.env.WEEKLY_DIGEST_TEST_EMAIL || '';
  const to          = testRedirect || email;

  // Format period-end date in a parent-friendly way. Stripe gives Unix
  // seconds; convert to a Date and render Month D, YYYY in en-US.
  let periodEndStr = '';
  if (currentPeriodEndUnix && Number.isFinite(currentPeriodEndUnix)) {
    try {
      const d = new Date(currentPeriodEndUnix * 1000);
      if (!isNaN(d.getTime())) {
        periodEndStr = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      }
    } catch (e) {}
  }

  // Plain-text fallback (Resend sends both)
  const accessLine = periodEndStr
    ? `You keep full access through ${periodEndStr}.`
    : 'Your access has ended.';
  const text = [
    'Hey there,',
    '',
    'Your MyGrind subscription has been canceled. ' + accessLine,
    '',
    "After that, your player's journal stays safe for 90 days. If you re-subscribe within that window, everything restores: entries, stats, goals, grades, photos.",
    '',
    'After 90 days, the account is permanently deleted.',
    '',
    'Questions or want to come back? Just reply to this email or write coach@mygrindapp.com.',
    '',
    'Coach',
    'The Grind'
  ].join('\n');

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0; padding:0; background:#0E0006; font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif; color:#F2EAD9;">
  <div style="max-width:560px; margin:0 auto; padding:32px 24px;">
    <div style="font-family:'Bebas Neue',sans-serif; font-size:28px; letter-spacing:2px; color:#E8C97A; margin-bottom:8px;">MY GRIND</div>
    <div style="height:2px; background:#B89A4B; width:64px; margin-bottom:24px;"></div>

    <p style="font-size:16px; line-height:1.6; color:#F2EAD9; margin:0 0 16px;">Hey there,</p>

    <p style="font-size:16px; line-height:1.6; color:#F2EAD9; margin:0 0 16px;">
      Your MyGrind subscription has been canceled. <strong style="color:#E8C97A;">${accessLine}</strong>
    </p>

    <p style="font-size:16px; line-height:1.6; color:#F2EAD9; margin:0 0 16px;">
      After that, your player's journal stays safe for <strong style="color:#E8C97A;">90 days</strong>. If you re-subscribe within that window, everything restores: entries, stats, goals, grades, photos.
    </p>

    <p style="font-size:14px; line-height:1.6; color:#999; margin:0 0 24px;">
      After 90 days, the account is permanently deleted.
    </p>

    <div style="background:rgba(184,154,75,0.06); border:1px solid #B89A4B; border-radius:6px; padding:14px 16px; margin-bottom:24px;">
      <p style="font-size:14px; line-height:1.6; color:#F2EAD9; margin:0;">
        Questions or want to come back? Reply to this email or write <a href="mailto:coach@mygrindapp.com" style="color:#E8C97A; text-decoration:none;">coach@mygrindapp.com</a>.
      </p>
    </div>

    <p style="font-size:15px; line-height:1.4; color:#F2EAD9; margin:0;">Coach</p>
    <p style="font-family:'Barlow Condensed',sans-serif; font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#B89A4B; margin:4px 0 0;">The Grind</p>
  </div>
</body></html>`;

  try {
    const resend = new Resend(apiKey);
    const subject = 'Your MyGrind subscription has been canceled';
    const result = await resend.emails.send({ from, to, subject, html, text });
    console.log('[stripe-webhook] cancellation email sent', { toHash: piiHash(to), plan, redirected: !!testRedirect, resendId: result?.data?.id });
    return { ok: true, id: result?.data?.id || null };
  } catch (e) {
    console.error('[stripe-webhook] cancellation email send failed:', e.message);
    return { ok: false, reason: 'send_error', error: e.message };
  }
}

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
        const plan = planForSubscription(sub);
        const upsertResult = await upsertSubscription({
          email,
          customerId:        sub.customer,
          subscriptionId:    sub.id,
          status:            'canceled',
          plan,
          currentPeriodEnd:  sub.current_period_end || null,
          cancelAtPeriodEnd: true,
          rawEventId:        event.id,
        });

        // Send the cancellation confirmation email to the billing
        // address on file (usually the parent). Honors the policy
        // promise on softball.html Settings ("billing email gets the
        // cancellation confirmation by email"). Skipped on Stripe
        // webhook retries — upsertSubscription returns skipped when
        // the event.id is a dup, in which case we already emailed.
        if (upsertResult && upsertResult.skipped) {
          console.log('[stripe-webhook] cancel email skipped (duplicate event)', { eventId: event.id });
        } else {
          await sendCancellationEmail({
            email,
            currentPeriodEndUnix: sub.current_period_end || null,
            plan,
          });
        }
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
