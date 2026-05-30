// ═══════════════════════════════════════════════════════════
// MyGrind — lib/access.js (owner-scoped access control)
// ───────────────────────────────────────────────────────────
// Shared gate for the V1 "by email" read/billing endpoints
// (get-subscription, stripe-portal-session, feedback-list?parent=).
// Proves the caller owns the email they're asking about by verifying
// a Firebase ID token (Authorization: Bearer <id-token>) and matching
// the token's email to the requested email. Reuses the same Firebase
// Auth the managedMinors endpoints already trust — no new secret.
//
// Behavior is controlled by the ACCESS_TOKEN_ENFORCE env var:
//
//   default / "true"  → PHASE 2 (CLOSED — current, enabled 2026-05-29):
//       • valid token whose email matches  → allow (verified)
//       • anything else                    → 401 (no token) / 403 (mismatch)
//
//   "false"           → PHASE 1 (grace — kill switch):
//       • valid token whose email matches  → allow (verified)
//       • valid token, email MISMATCH      → 403 (real cross-account attack)
//       • no/invalid token                 → allow (legacy token-less callers)
//     Reverts to "accept tokens but don't require them" if a deploy surfaces a
//     token-delivery problem. Clients degrade gracefully on 401/403 (cached
//     state / fallback links) either way, so toggling is low-risk.
// ═══════════════════════════════════════════════════════════

import { verifyBearer } from './firebase-admin.js';

export function isEnforced() {
  // PHASE 2 (enabled 2026-05-29): enforcement is ON by default. Kill switch —
  // set env ACCESS_TOKEN_ENFORCE=false in Vercel (applies on next deploy) to
  // revert to Phase-1 grace (accept token-less callers) without a git change.
  return String(process.env.ACCESS_TOKEN_ENFORCE || 'true').trim().toLowerCase() !== 'false';
}

// Resolve whether the caller is authorized to act on `requestedEmail`.
// Returns one of:
//   { ok: true,  verified: true,  email, uid }            — token matched
//   { ok: true,  verified: false }                        — Phase-1 grace (no token)
//   { ok: false, status: 401, error: 'auth_required' }    — Phase-2, no token
//   { ok: false, status: 403, error: 'forbidden' }        — token email != requested
export async function authorizeEmailOwner(req, requestedEmail) {
  const norm = String(requestedEmail || '').trim().toLowerCase();
  const auth = await verifyBearer(req);

  if (auth.ok) {
    // A valid token is present — always require it to match the requested
    // email, in BOTH phases. A present-but-mismatched token is an attacker
    // using their own session to read someone else's data.
    if (auth.email && auth.email === norm) {
      return { ok: true, verified: true, email: auth.email, uid: auth.uid };
    }
    return { ok: false, status: 403, error: 'forbidden' };
  }

  // No valid token (missing_bearer / invalid_token / admin_not_configured).
  if (isEnforced()) {
    return { ok: false, status: 401, error: 'auth_required' };
  }
  return { ok: true, verified: false };
}
