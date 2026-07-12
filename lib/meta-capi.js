// ═══════════════════════════════════════════════════════════
// MyGrind — lib/meta-capi.js (Meta Conversions API sender)
// ───────────────────────────────────────────────────────────
// Server-side Meta pixel events. Built 2026-07-12 after the day-3 ad
// read proved the BROWSER pixel's conversion events never reach Meta:
// PageView/ViewContent arrive, but InitiateCheckout and
// CompleteRegistration were received ZERO times from real visitors
// (tracker blocking eats facebook.com/tr on most of the 96%-mobile
// audience; GA4's twins arrive fine). The ad set optimizes on
// InitiateCheckout, so without this the campaign learns from silence.
//
// Pattern mirrors fireGa4Purchase in api/stripe-webhook.js:
//   - DORMANT until META_CAPI_ACCESS_TOKEN is set in the environment.
//   - Fire-and-forget: never throws, never blocks, never breaks a
//     checkout. 3s timeout.
//   - event_id is caller-supplied and deterministic (Stripe session id)
//     so Stripe webhook retries and re-fires dedupe on Meta's side.
//
// Meta docs: POST graph.facebook.com/v21.0/{dataset_id}/events
// user_data.em must be SHA-256 of the lowercased, trimmed email.
// ═══════════════════════════════════════════════════════════

import crypto from 'crypto';

const DATASET_ID = '326334441984368'; // My Pixel (Events Manager)
const GRAPH_URL = 'https://graph.facebook.com/v21.0/' + DATASET_ID + '/events';

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

// sendMetaEvent({ eventName, eventId, email, clientIp, userAgent, fbp, fbc,
//                 eventSourceUrl, customData, testEventCode })
// All fields optional except eventName + eventId. Returns { ok } and NEVER throws.
export async function sendMetaEvent({
  eventName,
  eventId,
  email,
  clientIp,
  userAgent,
  fbp,
  fbc,
  eventSourceUrl,
  customData,
  testEventCode,
}) {
  const token = process.env.META_CAPI_ACCESS_TOKEN;
  if (!token) return { ok: false, reason: 'dormant_no_token' };
  if (!eventName || !eventId) return { ok: false, reason: 'missing_required' };

  const userData = {};
  if (email) userData.em = [sha256(email.trim().toLowerCase())];
  if (clientIp) userData.client_ip_address = clientIp;
  if (userAgent) userData.client_user_agent = userAgent;
  // fbp/fbc come from the browser's _fbp/_fbc cookies, relayed by the
  // client in the checkout POST. fbc is what lets Meta attribute the
  // conversion to the ad click. Sanitized: Meta's own formats only.
  if (fbp && /^fb\.[0-9.]+\.[\w-]+$/.test(fbp)) userData.fbp = fbp;
  if (fbc && /^fb\.[0-9.]+\.[\w-]+$/.test(fbc)) userData.fbc = fbc;

  const body = {
    data: [{
      event_name:       eventName,
      event_time:       Math.floor(Date.now() / 1000),
      event_id:         String(eventId),
      action_source:    'website',
      event_source_url: eventSourceUrl || 'https://www.mygrindapp.com/signup.html',
      user_data:        userData,
      ...(customData ? { custom_data: customData } : {}),
    }],
    ...(testEventCode ? { test_event_code: testEventCode } : {}),
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const resp = await fetch(GRAPH_URL + '?access_token=' + encodeURIComponent(token), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      console.warn('[meta-capi] send failed (non-fatal)', { event: eventName, status: resp.status, err: json && json.error && json.error.message });
      return { ok: false, reason: 'http_' + resp.status };
    }
    console.log('[meta-capi] sent', { event: eventName, eventId: String(eventId).slice(0, 24), received: json.events_received });
    return { ok: true };
  } catch (e) {
    console.warn('[meta-capi] send error (non-fatal):', e && e.message);
    return { ok: false, reason: 'exception' };
  }
}
