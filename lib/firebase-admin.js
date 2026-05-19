// ═══════════════════════════════════════════════════════════
// MyGrind — lib/firebase-admin.js (server-side Firebase Auth)
// ───────────────────────────────────────────────────────────
// Lazy-init wrapper around firebase-admin so multiple serverless
// functions can import it without re-initializing on every call.
//
// Required env var:
//   FIREBASE_ADMIN_SERVICE_ACCOUNT — JSON string of the service-account
//   credentials downloaded from Firebase Console → Project Settings →
//   Service Accounts → "Generate new private key." Paste the FULL JSON
//   into Vercel as one env var value (no minification needed — JSON.parse
//   handles whitespace). Mark it "Sensitive" in Vercel so it doesn't show
//   in build logs.
//
// Used today by:
//   api/auth/magic-link-verify.js — mints custom tokens so signin.html
//     can sign users in after they tap a Resend-branded link.
//
// If the env var is missing, getAuth() returns null and callers should
// fall back to a non-Admin code path (e.g. Firebase's built-in
// sendSignInLinkToEmail used by signin.html as the V1 default).
// ═══════════════════════════════════════════════════════════

import admin from 'firebase-admin';

let _app = null;
let _attemptedInit = false;

export function getAdminAuth() {
  if (_app) return admin.auth(_app);
  if (_attemptedInit) return null;
  _attemptedInit = true;

  const raw = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT;
  if (!raw) {
    console.warn('[firebase-admin] FIREBASE_ADMIN_SERVICE_ACCOUNT not set — admin features disabled');
    return null;
  }

  let cred;
  try {
    cred = JSON.parse(raw);
  } catch (e) {
    console.error('[firebase-admin] failed to parse FIREBASE_ADMIN_SERVICE_ACCOUNT JSON:', e.message);
    return null;
  }

  try {
    _app = admin.initializeApp({
      credential: admin.credential.cert(cred),
      projectId:  cred.project_id || 'my-grind-b8486',
    });
    return admin.auth(_app);
  } catch (e) {
    console.error('[firebase-admin] initializeApp failed:', e.message);
    return null;
  }
}

// Mints a Firebase custom token tied to a specific user (creates the user
// in Firebase Auth if they don't exist yet). The client uses the returned
// token with firebase.auth().signInWithCustomToken(token) to complete sign-in.
//
// Custom tokens are valid for ~1 hour. The expected flow is: server mints
// → returns to client immediately → client signs in within seconds. We
// don't pass them around or store them.
export async function mintCustomTokenForEmail(email) {
  const auth = getAdminAuth();
  if (!auth) return { ok: false, error: 'admin_not_configured' };

  const normEmail = (email || '').trim().toLowerCase();
  if (!normEmail) return { ok: false, error: 'missing_email' };

  let user;
  try {
    user = await auth.getUserByEmail(normEmail);
  } catch (e) {
    if (e.code === 'auth/user-not-found') {
      try {
        user = await auth.createUser({ email: normEmail, emailVerified: true });
      } catch (createErr) {
        console.error('[firebase-admin] createUser failed:', createErr.message);
        return { ok: false, error: 'create_user_failed' };
      }
    } else {
      console.error('[firebase-admin] getUserByEmail failed:', e.message);
      return { ok: false, error: 'lookup_failed' };
    }
  }

  // Mark email verified — the magic-link click is itself the verification.
  // Safe to call repeatedly (no-op when already verified).
  if (user && !user.emailVerified) {
    try { await auth.updateUser(user.uid, { emailVerified: true }); }
    catch (e) { /* non-fatal, custom token still works */ }
  }

  try {
    const token = await auth.createCustomToken(user.uid, { signInVia: 'magic_link' });
    return { ok: true, customToken: token, uid: user.uid, email: normEmail };
  } catch (e) {
    console.error('[firebase-admin] createCustomToken failed:', e.message);
    return { ok: false, error: 'mint_failed' };
  }
}
