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
//   - invoice.payment_succeeded   ← ENABLE THIS in the Stripe dashboard for
//        trial→paid conversion tracking (GA4 purchase + converted email).
//        Code handles it; Stripe won't deliver it until it's subscribed.
//   - invoice.payment_failed
//
// Idempotency: Stripe may retry the same event multiple times.
// upsertSubscription() compares event.id to the last one stored
// per customer and skips duplicates.
// ═══════════════════════════════════════════════════════════

import Stripe from 'stripe';
import { Resend } from 'resend';
import crypto from 'crypto';
import Redis from 'ioredis';
import { upsertSubscription } from '../lib/subscription-store.js';
import { recordTrialUsed } from '../lib/trial-eligibility-store.js';
import { getAdminAuth } from '../lib/firebase-admin.js';

// Redis singleton for the post-payment welcome flow. Reuses the same
// `magiclink:<token>` key shape that api/magic-link-verify.js consumes,
// so no new verify endpoint is needed. 24-hour TTL (vs. the 15-min TTL on
// self-initiated magic-link-request) because a paying customer may not
// open their email immediately.
let _redis = null;
function getRedis() {
  if (_redis) return _redis;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  _redis = new Redis(url, { maxRetriesPerRequest: 2, enableReadyCheck: false });
  _redis.on('error', (e) => console.error('[stripe-webhook] redis:', e.message));
  return _redis;
}

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

// ─── POST-PAYMENT DELIVERY ─────────────────────────────────
// Closes the gap between Stripe checkout and the customer actually getting
// into the app. Before this, paying customers landed in Redis subscription
// state but never got a sign-in email and never showed up in Firebase Auth.
// Lost Brandon Sonnier 2026-05-26 in exactly this hole (paid $149.99
// Family annual, was locked out, had to be hand-rescued).
//
// ensureFirebaseAuthUser: creates the Auth row if not present, so the
// customer shows up in the Firebase dashboard immediately after payment
// rather than only after they tap the welcome link.
//
// sendPostPaymentWelcomeEmail: branded Resend email with a magiclink
// token (24h TTL, same `magiclink:<token>` shape as magic-link-request.js
// so magic-link-verify.js consumes it unchanged).
//
// Both helpers fail soft — Stripe's source-of-truth subscription state
// must succeed regardless of email or Auth-creation outcomes.
async function ensureFirebaseAuthUser(email) {
  try {
    const auth = getAdminAuth();
    if (!auth) {
      console.warn('[stripe-webhook] ensureFirebaseAuthUser skipped: admin not configured');
      return { ok: false, reason: 'admin_not_configured' };
    }
    const normEmail = String(email || '').trim().toLowerCase();
    if (!normEmail) return { ok: false, reason: 'no_email' };
    try {
      const existing = await auth.getUserByEmail(normEmail);
      console.log('[stripe-webhook] auth user already exists', { emailHash: piiHash(normEmail), uid: existing.uid });
      return { ok: true, created: false, uid: existing.uid };
    } catch (e) {
      if (e.code === 'auth/user-not-found') {
        const user = await auth.createUser({ email: normEmail, emailVerified: true });
        console.log('[stripe-webhook] auth user created', { emailHash: piiHash(normEmail), uid: user.uid });
        return { ok: true, created: true, uid: user.uid };
      }
      throw e;
    }
  } catch (e) {
    console.error('[stripe-webhook] ensureFirebaseAuthUser failed (non-fatal):', e.message);
    return { ok: false, reason: 'lookup_or_create_failed', error: e.message };
  }
}

async function sendPostPaymentWelcomeEmail({ email }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[stripe-webhook] welcome email skipped: RESEND_API_KEY not set');
    return { ok: false, reason: 'no_api_key' };
  }
  const normEmail = String(email || '').trim().toLowerCase();
  if (!normEmail) {
    console.warn('[stripe-webhook] welcome email skipped: no recipient email');
    return { ok: false, reason: 'no_email' };
  }
  const r = getRedis();
  if (!r) {
    console.warn('[stripe-webhook] welcome email skipped: redis unavailable');
    return { ok: false, reason: 'no_redis' };
  }

  // Per-email idempotency flag (90-day TTL). Prevents Stripe's automatic
  // retries from double-sending the welcome email. Separate from
  // upsertSubscription's per-event guard so an intentional event "Resend"
  // from the Stripe dashboard (the backfill path for legacy paying
  // customers like Brandon Sonnier) still triggers the email — only an
  // actual successful prior send blocks it.
  // Per-email idempotency: only honor the flag if the stored value looks
  // like a real Resend message ID (starts with "re_"). Older versions of
  // this function stored "1" even when Resend rejected the send (e.g.
  // unverified domain), so flag values that don't look like a real ID
  // are treated as "not yet sent" and we retry. New successful sends
  // overwrite with the actual Resend ID.
  const welcomeFlagKey = 'welcome_sent:' + crypto.createHash('sha256').update(normEmail).digest('hex').slice(0, 16);
  try {
    const alreadySent = await r.get(welcomeFlagKey);
    if (typeof alreadySent === 'string' && alreadySent.startsWith('re_')) {
      console.log('[stripe-webhook] welcome email skipped: already sent for this email', { emailHash: piiHash(normEmail), priorResendId: alreadySent });
      return { ok: true, skipped: 'already_sent' };
    }
    if (alreadySent) {
      console.log('[stripe-webhook] welcome-flag has stale value (likely from a failed send) — retrying', { emailHash: piiHash(normEmail), staleValue: alreadySent });
    }
  } catch (e) {
    // Read failure is non-fatal — better to risk a duplicate welcome than
    // to silently skip a real customer. Fall through to send.
    console.warn('[stripe-webhook] welcome-flag read failed (continuing):', e.message);
  }

  // Generate one-time token + store in Redis with 24-hour TTL. Reuses
  // the magiclink key shape so signin.html?mode=magicLink&token=X
  // works out of the box via the existing magic-link-verify endpoint.
  const token = crypto.randomBytes(16).toString('hex');
  try {
    await r.set('magiclink:' + token, normEmail, 'EX', 24 * 60 * 60);
  } catch (e) {
    console.error('[stripe-webhook] welcome email redis SET failed:', e.message);
    return { ok: false, reason: 'storage_failed' };
  }

  const signinUrl    = 'https://www.mygrindapp.com/signin.html?mode=magicLink&token=' + token;
  const from         = process.env.RESEND_FROM || 'MyGrind <coach@mygrindapp.com>';
  const testRedirect = process.env.WEEKLY_DIGEST_TEST_EMAIL || '';
  const to           = testRedirect || normEmail;

  const text = [
    'Welcome to MyGrind.',
    '',
    'Your account is live. Tap the link below to sign in. It works for 24 hours.',
    '',
    signinUrl,
    '',
    "Once you're in, head to the players section to add your kid (or kids, if you grabbed a Family plan). Each player gets their own profile, their own journal, their own grind.",
    '',
    'Tip: open this email on your phone and tap the button there, then add MyGrind to your home screen for one-tap access every day.',
    '',
    'Questions? Reply to this email or write coach@mygrindapp.com.',
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

    <p style="font-size:16px; line-height:1.6; color:#F2EAD9; margin:0 0 18px;">Welcome to MyGrind.</p>

    <p style="font-size:16px; line-height:1.6; color:#F2EAD9; margin:0 0 24px;">
      Your account is live. Tap the button below to sign in. <strong style="color:#E8C97A;">This link works for 24 hours.</strong>
    </p>

    <div style="text-align:center; margin:0 0 28px;">
      <a href="${signinUrl}" style="display:inline-block; background:#E8C97A; color:#080808; font-family:'Barlow Condensed',sans-serif; font-size:13px; font-weight:800; letter-spacing:2px; text-transform:uppercase; padding:16px 28px; border-radius:8px; text-decoration:none;">Sign In to MyGrind &rarr;</a>
    </div>

    <p style="font-size:13px; line-height:1.6; color:#9F9486; margin:0 0 22px;">
      Or copy this link into your browser:<br>
      <a href="${signinUrl}" style="color:#E8C97A; text-decoration:none; word-break:break-all;">${signinUrl}</a>
    </p>

    <div style="background:rgba(184,154,75,0.06); border:1px solid #B89A4B; border-radius:6px; padding:14px 16px; margin-bottom:24px;">
      <p style="font-size:14px; line-height:1.6; color:#F2EAD9; margin:0;">
        Once you're in, head to the <strong style="color:#E8C97A;">players section</strong> to add your kid (or kids, if you grabbed a Family plan). Each player gets their own profile, their own journal, their own grind.
      </p>
    </div>

    <p style="font-size:13px; line-height:1.6; color:#9F9486; margin:0 0 22px;">
      <strong style="color:#E8C97A;">Tip:</strong> open this email on your phone and tap the button there, then add MyGrind to your home screen for one-tap access every day.
    </p>

    <p style="font-size:13px; line-height:1.6; color:#9F9486; margin:0 0 24px;">
      Questions? Reply to this email or write <a href="mailto:coach@mygrindapp.com" style="color:#E8C97A; text-decoration:none;">coach@mygrindapp.com</a>.
    </p>

    <p style="font-size:15px; line-height:1.4; color:#F2EAD9; margin:0;">Coach</p>
    <p style="font-family:'Barlow Condensed',sans-serif; font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#B89A4B; margin:4px 0 0;">The Grind</p>
  </div>
</body></html>`;

  try {
    const resend = new Resend(apiKey);
    const result = await resend.emails.send({
      from,
      to,
      subject: 'Welcome to MyGrind. Your sign-in link is inside.',
      html,
      text,
      replyTo: 'coach@mygrindapp.com',
    });

    // Resend's SDK doesn't throw on API errors (4xx/5xx) — it returns
    // { data, error }. The original version of this function treated any
    // non-thrown response as success and set the idempotency flag, which
    // is what locked Brandon Sonnier out: domain wasn't verified yet,
    // Resend returned { data: null, error: '...' }, code set the flag to
    // "1", every subsequent retry was skipped before reaching Resend.
    // Fix: explicitly inspect result.error and the presence of a real ID.
    const resendId = result?.data?.id || null;
    const resendError = result?.error || null;
    if (resendError || !resendId) {
      const errMsg = resendError?.message || resendError?.name || 'no_id_returned';
      console.error('[stripe-webhook] welcome email rejected by Resend (non-fatal):', {
        emailHash: piiHash(normEmail),
        toHash:    piiHash(to),
        error:     errMsg,
      });
      return { ok: false, reason: 'resend_rejected', error: errMsg };
    }

    console.log('[stripe-webhook] welcome email sent', {
      toHash:      piiHash(to),
      redirected:  !!testRedirect,
      resendId,
      tokenPrefix: token.slice(0, 6),
    });

    // Mark this email as welcomed (90-day TTL). Store the actual Resend
    // ID so the read-side check can distinguish a real prior send from
    // a stale legacy "1" value. Future Stripe retries of the same
    // checkout.session.completed will see the flag and skip the send.
    try {
      await r.set(welcomeFlagKey, resendId, 'EX', 90 * 24 * 60 * 60);
    } catch (e) {
      console.warn('[stripe-webhook] welcome-flag write failed (non-fatal):', e.message);
    }
    return { ok: true, id: resendId };
  } catch (e) {
    console.error('[stripe-webhook] welcome email send threw (non-fatal):', e.message);
    return { ok: false, reason: 'send_threw', error: e.message };
  }
}

// ─── GA4 PURCHASE (Measurement Protocol, 2026-06-02) ───────
// Server-side `purchase` event so GA4 closes the funnel begin_checkout →
// purchase with a signal that (a) can't be spoofed from the browser and
// (b) only fires on confirmed money movement. DORMANT by default — does
// nothing until GA4_API_SECRET is set in Vercel (create one in GA4 Admin →
// Data Streams → the web stream → Measurement Protocol API secrets). Fails
// soft: a GA4 hiccup must NEVER fail the webhook, or a paying customer's
// subscription record + welcome email are dropped.
//
// client_id: prefer the real value threaded from the browser via
// create-checkout-session metadata (mg_ga_client_id) so the purchase stitches
// to the user's GA4 session; fall back to a deterministic synthetic id so the
// purchase still counts even on the static Payment Link paths.
//
// NOTE (card-on-file): the standard signup path completes checkout with
// amount_total = 0 (trial, no charge today), so this is correctly SKIPPED for
// trials — the real conversion is the trial-end charge. Wiring purchase on
// trial-end requires subscribing invoice.payment_succeeded (not done yet);
// mg_ga_client_id is already copied onto subscription metadata for that.
function fallbackClientId(seed) {
  const h = crypto.createHash('sha256').update(String(seed || 'mg')).digest('hex');
  return parseInt(h.slice(0, 8), 16) + '.' + parseInt(h.slice(8, 16), 16);
}

// Fired from two places: the immediate-pay checkout (checkout.session.completed,
// money today) and the trial-end charge (invoice.payment_succeeded, the trial→
// paid conversion). Idempotent PER CUSTOMER via an atomic SET NX, so `purchase`
// lands exactly once per customer regardless of which event arrives first or how
// many times Stripe retries — an immediate-pay customer's later renewal invoice
// sees the flag and is skipped, never double-counted.
async function fireGa4Purchase({ customerId, clientId, transactionId, amountCents, currency, plan }) {
  const apiSecret = process.env.GA4_API_SECRET;
  if (!apiSecret) return { ok: false, reason: 'dormant_no_api_secret' };

  const measurementId = process.env.GA4_MEASUREMENT_ID || 'G-5HLS0F06CQ';
  const cents = Number(amountCents);
  if (!Number.isFinite(cents) || cents <= 0) return { ok: false, reason: 'no_charge' };

  const idSeed = customerId || transactionId || 'unknown';
  const r = getRedis();
  const flagKey = 'ga_purchase_sent:' + crypto.createHash('sha256').update(String(idSeed)).digest('hex').slice(0, 16);
  if (r) {
    try {
      // SET NX returns 'OK' only on first write. Reserve BEFORE the network
      // call so concurrent retries can't both send. 5-year TTL ≈ permanent.
      const setRes = await r.set(flagKey, '1', 'EX', 5 * 365 * 24 * 60 * 60, 'NX');
      if (setRes !== 'OK') return { ok: true, skipped: 'already_sent' };
    } catch (e) { /* fall through — a rare dup beats a miss */ }
  }

  const attributed = !!clientId;
  const payload = {
    client_id: attributed ? clientId : fallbackClientId(idSeed),
    non_personalized_ads: false,
    events: [{
      name: 'purchase',
      params: {
        transaction_id: String(transactionId || idSeed),
        value: cents / 100,
        currency: (currency || 'usd').toUpperCase(),
        plan: plan || 'unknown',
      },
    }],
  };

  try {
    const url = 'https://www.google-analytics.com/mp/collect?measurement_id='
      + encodeURIComponent(measurementId) + '&api_secret=' + encodeURIComponent(apiSecret);
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    // MP returns 204 on success and does not validate event names on the live
    // endpoint (use /debug/mp/collect for that). If the POST failed, release
    // the reservation so a Stripe retry can try again.
    if (!resp.ok && r) { try { await r.del(flagKey); } catch (e) {} }
    console.log('[stripe-webhook] ga4 purchase sent', { txn: payload.events[0].params.transaction_id, status: resp.status, attributed, value: cents / 100 });
    return { ok: resp.ok, status: resp.status };
  } catch (e) {
    if (r) { try { await r.del(flagKey); } catch (_) {} }
    console.error('[stripe-webhook] ga4 purchase send failed (non-fatal):', e.message);
    return { ok: false, reason: 'send_threw', error: e.message };
  }
}

// ─── TRIAL-CONVERTED EMAIL (2026-06-02) ────────────────────
// Sent once, when a free trial takes its first real charge (the trial→paid
// conversion). NOT sent on immediate-pay's first invoice (those parents were
// already welcomed at checkout) or on later renewals — the caller gates this
// on billing_reason === 'subscription_cycle' + a per-customer SET NX flag.
// Fails soft; reuses the WEEKLY_DIGEST_TEST_EMAIL redirect like the others.
async function sendTrialConvertedEmail({ email, plan }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) { console.warn('[stripe-webhook] converted email skipped: RESEND_API_KEY not set'); return { ok: false, reason: 'no_api_key' }; }
  const normEmail = String(email || '').trim().toLowerCase();
  if (!normEmail) { console.warn('[stripe-webhook] converted email skipped: no recipient'); return { ok: false, reason: 'no_email' }; }

  const from         = process.env.RESEND_FROM || 'MyGrind <coach@mygrindapp.com>';
  const testRedirect = process.env.WEEKLY_DIGEST_TEST_EMAIL || '';
  const to           = testRedirect || normEmail;
  const appUrl       = 'https://www.mygrindapp.com/softball.html';

  const text = [
    'Hey there,',
    '',
    'Your free trial just turned into a full membership. The first payment went through, and your player keeps right on grinding. No interruption, nothing you need to do.',
    '',
    'Everything you have been building stays exactly where it is: entries, stats, goals, grades, every rep logged.',
    '',
    'Thank you for betting on the work. Keep showing up.',
    '',
    'Open MyGrind: ' + appUrl,
    '',
    'Questions or want to make a change? Reply to this email or write coach@mygrindapp.com.',
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

    <p style="font-size:16px; line-height:1.6; color:#F2EAD9; margin:0 0 18px;">Hey there,</p>

    <p style="font-size:16px; line-height:1.6; color:#F2EAD9; margin:0 0 18px;">
      Your free trial just turned into a full membership. <strong style="color:#E8C97A;">The first payment went through</strong>, and your player keeps right on grinding. No interruption, nothing you need to do.
    </p>

    <p style="font-size:16px; line-height:1.6; color:#F2EAD9; margin:0 0 24px;">
      Everything you have been building stays exactly where it is: entries, stats, goals, grades, every rep logged.
    </p>

    <div style="text-align:center; margin:0 0 28px;">
      <a href="${appUrl}" style="display:inline-block; background:#E8C97A; color:#080808; font-family:'Barlow Condensed',sans-serif; font-size:13px; font-weight:800; letter-spacing:2px; text-transform:uppercase; padding:16px 28px; border-radius:8px; text-decoration:none;">Open MyGrind &rarr;</a>
    </div>

    <p style="font-size:14px; line-height:1.6; color:#F2EAD9; margin:0 0 24px;">
      Thank you for betting on the work. Keep showing up.
    </p>

    <div style="background:rgba(184,154,75,0.06); border:1px solid #B89A4B; border-radius:6px; padding:14px 16px; margin-bottom:24px;">
      <p style="font-size:14px; line-height:1.6; color:#F2EAD9; margin:0;">
        Questions or want to make a change? Reply to this email or write <a href="mailto:coach@mygrindapp.com" style="color:#E8C97A; text-decoration:none;">coach@mygrindapp.com</a>.
      </p>
    </div>

    <p style="font-size:15px; line-height:1.4; color:#F2EAD9; margin:0;">Coach</p>
    <p style="font-family:'Barlow Condensed',sans-serif; font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#B89A4B; margin:4px 0 0;">The Grind</p>
  </div>
</body></html>`;

  try {
    const resend = new Resend(apiKey);
    const result = await resend.emails.send({ from, to, subject: "You're officially a MyGrind member.", html, text, replyTo: 'coach@mygrindapp.com' });
    const resendId = result?.data?.id || null;
    const resendError = result?.error || null;
    if (resendError || !resendId) {
      console.error('[stripe-webhook] converted email rejected by Resend (non-fatal):', { emailHash: piiHash(normEmail), error: resendError?.message || 'no_id_returned' });
      return { ok: false, reason: 'resend_rejected' };
    }
    console.log('[stripe-webhook] trial-converted email sent', { toHash: piiHash(to), plan, redirected: !!testRedirect, resendId });
    return { ok: true, id: resendId };
  } catch (e) {
    console.error('[stripe-webhook] converted email send threw (non-fatal):', e.message);
    return { ok: false, reason: 'send_threw', error: e.message };
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
  'price_1TgoABPm4ermqky4P5gdMAtX': 'single_annual',      // $99.99/yr (prod_UPIFHJyfyTvBYy), created 2026-06
  'price_1TQTDYPm4ermqky4TXgbfwFT': 'single_annual',      // legacy $99.99/yr (retired "Annual Price" product) — kept 2026-06-19 so any pre-consolidation annual sub still resolves
  'price_1TT69tPm4ermqky4CYkbQcEf': 'family_monthly',     // $14.99/mo (prod_US0A0CbUborFoY)
  'price_1TT68UPm4ermqky47QJZ8SnB': 'family_annual',      // $149.99/yr (prod_US08Tl9LglAWq7)
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

        // Post-payment delivery: both helpers are self-idempotent so they
        // can run on every paid checkout.session.completed (including
        // intentional event resends from the Stripe dashboard, used to
        // backfill customers paid before the welcome-email code existed).
        // ensureFirebaseAuthUser checks getUserByEmail first; the welcome
        // email gates on a per-email Redis flag (welcome_sent:<hash>) set
        // after a successful send. Stripe retries are blocked by that
        // flag; subscription-state idempotency lives in upsertSubscription.
        // Fires for BOTH immediate-pay ('paid' — annual upfront / skip-trial)
        // AND card-on-file trial signups ('no_payment_required' — the default
        // funnel), so trial parents get the same branded welcome + sign-in
        // email and a Firebase Auth row at signup, not only after they later
        // self-serve a sign-in. Both helpers are idempotent (Auth checks
        // getUserByEmail first; the email gates on a per-email Redis flag), so
        // Stripe retries never double-send. 'unpaid' (async payment still
        // pending) is intentionally excluded — wait for a later event.
        if (session.payment_status === 'paid' || session.payment_status === 'no_payment_required') {
          await ensureFirebaseAuthUser(email);
          await sendPostPaymentWelcomeEmail({ email });
        }

        // GA4 server-side purchase. Dormant until GA4_API_SECRET is set, and
        // self-guards on amount_total > 0 (so $0 card-on-file trial signups
        // are skipped here — their conversion fires from the trial-end charge
        // in invoice.payment_succeeded below). Idempotent per customer.
        await fireGa4Purchase({
          customerId:    session.customer,
          clientId:      session.metadata?.mg_ga_client_id || '',
          transactionId: session.id,
          amountCents:   session.amount_total,
          currency:      session.currency,
          plan:          session.metadata?.mg_plan_type || 'unknown',
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
        // Option A — if the subscription has any active status (trialing /
        // active / past_due) it means Stripe has a payment method on file.
        // Webhook events don't always include the payment_method id, so we
        // infer card-on-file from the subscription status itself.
        const STATUSES_WITH_CARD = new Set(['trialing', 'active', 'past_due']);
        const hasCardOnFile = STATUSES_WITH_CARD.has(sub.status);
        await upsertSubscription({
          email,
          customerId:        sub.customer,
          subscriptionId:    sub.id,
          status:            sub.status,
          plan:              planForSubscription(sub),
          currentPeriodEnd:  sub.current_period_end || null,
          cancelAtPeriodEnd: !!sub.cancel_at_period_end,
          hasCardOnFile,
          rawEventId:        event.id,
        });

        // Belt-and-suspenders trial-used recording (Tier 1 abuse prevention,
        // 2026-05-18). Catches the "user pays upfront via skip-trial path"
        // case — they hit Stripe directly without ever reaching Screen 8 of
        // signup.html, so /api/start-trial wouldn't have recorded them.
        // Stripe doesn't include phone on the subscription object, so we
        // only record by email here. The signup.html /api/start-trial call
        // records phone too on the regular trial path. Idempotent via SET NX.
        if (event.type === 'customer.subscription.created') {
          try {
            const rec = await recordTrialUsed({
              email,
              phone: null, // Stripe webhook doesn't carry the player phone
              source: 'stripe-webhook-' + event.type.replace(/\./g, '-'),
            });
            if (rec.ok && rec.recorded && rec.recorded.length) {
              console.log('[stripe-webhook] trial recorded:', { emailHash: piiHash(email), recorded: rec.recorded });
            }
          } catch (e) {
            console.error('[stripe-webhook] trial record failed (non-fatal):', e.message);
          }
        }
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

      case 'invoice.payment_succeeded': {
        // Real money moved on a subscription invoice. The two cases that
        // matter: a trial just ended and took its first charge (trial→paid
        // conversion), and ordinary renewals. We fire the GA4 purchase once
        // per customer (interlocks with the checkout path) and send the
        // trial-converted email only on the first cycle charge.
        const invoice = event.data.object;
        if (!invoice.amount_paid || invoice.amount_paid <= 0) break; // $0 trial-start invoice — ignore
        if (!invoice.subscription) break;                            // one-off, not a subscription

        let email = invoice.customer_email;
        if (!email && invoice.customer) {
          try { const c = await stripe.customers.retrieve(invoice.customer); email = c.email; } catch (e) { /* fall through */ }
        }
        if (!email) {
          console.warn('[stripe-webhook] invoice.payment_succeeded: no email', { invoiceId: invoice.id, customerId: invoice.customer });
          break;
        }

        // The invoice carries neither the plan label nor the GA4 client_id —
        // both live on the subscription metadata (set at create-checkout-session).
        let plan = 'unknown', gaClientId = '', hadTrial = false;
        try {
          const sub = await stripe.subscriptions.retrieve(invoice.subscription);
          plan = planForSubscription(sub);
          gaClientId = (sub.metadata && sub.metadata.mg_ga_client_id) || '';
          // hadTrial separates a real trial→paid conversion from an immediate-
          // pay subscription's first renewal (both are 'subscription_cycle').
          hadTrial = !!(sub.trial_end || sub.trial_start);
        } catch (e) {
          console.warn('[stripe-webhook] invoice.payment_succeeded: subscription retrieve failed:', e.message);
        }

        // GA4 purchase — once per customer. An immediate-pay customer already
        // fired it at checkout, so their first invoice here is a no-op.
        await fireGa4Purchase({
          customerId:    invoice.customer,
          clientId:      gaClientId,
          transactionId: invoice.id,
          amountCents:   invoice.amount_paid,
          currency:      invoice.currency,
          plan,
        });

        // Trial→paid conversion email: only when the subscription actually had
        // a trial AND this is a billing-cycle charge (the trial-end charge),
        // and only once per customer. This excludes immediate-pay's first
        // invoice ('subscription_create', already welcomed) AND its first
        // renewal (a cycle invoice on a sub that never had a trial). Later
        // renewals of a converted trial are blocked by the per-customer flag.
        if (hadTrial && invoice.billing_reason === 'subscription_cycle') {
          const r = getRedis();
          let firstConversion = true;
          if (r) {
            const convertedKey = 'trial_converted:' + crypto.createHash('sha256').update(String(invoice.customer || email)).digest('hex').slice(0, 16);
            try {
              const setRes = await r.set(convertedKey, '1', 'EX', 5 * 365 * 24 * 60 * 60, 'NX');
              firstConversion = (setRes === 'OK');
            } catch (e) { /* treat as first — a possible dup beats missing the conversion */ }
          }
          if (firstConversion) {
            await ensureFirebaseAuthUser(email); // belt-and-suspenders; idempotent
            await sendTrialConvertedEmail({ email, plan });
          }
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
    // Return 500 so Stripe RETRIES the event (it retries 4xx/5xx with
    // backoff for ~3 days). A transient failure here — e.g. a Redis blip
    // during checkout.session.completed — must NOT be acknowledged as
    // success, or the paying customer's auth user + welcome email are
    // silently dropped with no retry. Safe to retry: the welcome email
    // gates on a per-email Redis flag, auth-user creation checks
    // getUserByEmail first, and subscription upsert is keyed by email —
    // all idempotent. Don't echo e.message back to the caller.
    return res.status(500).json({ ok: false, error: 'handler_error' });
  }

  return res.status(200).json({ ok: true, received: event.type });
}
