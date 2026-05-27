# MyGrind COPPA Runbook

*Last updated: 2026-05-27. Owner: Coach (My Grind Sports LLC).*

This runbook covers how to handle every COPPA-adjacent operational request that comes in for MyGrind. Use it whenever a parent emails support, whenever a regulator pings us, and once a year for the standing review.

## 1. Parent requests to view their child's data

The parent does this themselves. We do not need to pull data from the backend unless they cannot reach it.

Reply with the following steps:

1. Sign in at https://mygrindapp.com/signin.html with the email on the Family account.
2. Open the journal (softball.html opens by default).
3. At the top of the screen, the "Switch player" dropdown lists every child profile under the account. Pick the child.
4. The journal now shows that child's profile, journal entries, goals, stats, and any photos uploaded into their profile. Everything we have collected is visible there.

If the parent cannot sign in (lost access, changed emails, etc.):

1. Verify the parent's identity by phone or by matching the Stripe billing email and last-4 on the card on file.
2. Pull `/users/{parentUid}/managedMinors/{minorId}` and `/users/{parentUid}/managedMinors/{minorId}/entries` from the Firebase Console Firestore tab and export as JSON.
3. Send the JSON via email reply within 30 days of the original request.

## 2. Parent requests to delete a child's profile

The parent does this themselves.

Reply with the following steps:

1. Sign in.
2. Open the profile switcher, pick the child.
3. Tap "Delete this profile" in the switcher bar.
4. Confirm. The child profile and every entry under it are removed from Firestore immediately.

If the parent cannot complete the in-app flow:

1. Verify identity as in §1.
2. Hit the `/api/managed-minors-delete` endpoint with the parent's Firebase ID token and the `minorId`, OR delete `/users/{parentUid}/managedMinors/{minorId}` and its `/entries` subcollection in the Firebase Console.
3. Reply confirming deletion within 30 days. Log the request in the "MyGrind — Parental Requests" Notion page (Date, parent email hash, minor id, action, completed-at).

## 3. Parent requests to delete the entire account

Standard account deletion handles both the parent's data and every child profile underneath. Follow the existing account-deletion SOP. If that doesn't exist yet, the manual steps are:

1. Identify the `parentUid` via Firebase Authentication.
2. Delete `/users/{parentUid}` and every subcollection (`entries`, `managedMinors/*`, `managedMinors/*/entries`).
3. Delete the Auth user.
4. Cancel the active Stripe subscription.
5. Remove the parent's email from any Mailchimp list (the only marketing list we run).
6. Reply confirming deletion within 30 days. Log the request.

## 4. Parent requests to refuse further data collection

Treat the request as a deletion request for the child profile (§2). Removing the profile is the operative refusal; no flag-only "freeze" exists in the data model.

If the parent wants to keep their own adult account but not have any child profile, delete each child profile per §2 and reply confirming. Future re-collection requires the parent to re-add the child via the in-app "Add child" flow, which re-triggers the verifiable parental consent path (Family-plan card on file).

## 5. FTC inquiry or regulator contact

Stop touching data. Escalate immediately.

1. Email the inquiry to the operator (Coach) and to the LLC's accountant of record (Sam Ketsoyan, 818-988-8989) within 24 hours of receipt. Do not respond to the regulator until counsel confirms.
2. Engage privacy counsel before any substantive reply. The standard FTC inquiry asks for: data inventory, consent mechanism, retention policy, parental access SOP, deletion SOP, vendor list with DPAs. All of those are documented (this runbook, privacy.html §6.5, firestore.rules in the repo).
3. Place a litigation hold: retain ALL parental-request logs, ALL access logs (Firebase Auth + Firestore audit), and ALL related email for a minimum of six months from the date of the inquiry. Do not delete any data referenced in the inquiry until counsel releases the hold.
4. Document the inquiry in Notion under "MyGrind — Regulator Inquiries" with the date received, regulator, scope, counsel engaged, response-due date, and status.

## 6. Annual COPPA compliance review checklist

Run this every 12 months (set as a Notion recurring task). The first review is due 2027-05-27.

- [ ] privacy.html §6.5 is still accurate. Every field listed in §6.5.1 is still everything we collect from a child under 13 — no new fields have been added without an update.
- [ ] privacy.html §5.1 vendor list matches the vendors actually used in production (check api/ + lib/ for any new service integrations since last review).
- [ ] firestore.rules in the repo matches the live rules in the Firebase Console. Mismatch = open a ticket to redeploy from the repo.
- [ ] No child under 13 has a separate Firebase Auth user. Query the Auth user list and confirm no account belongs to a user we know is under 13 (cross-check the Family accounts' managedMinors collections).
- [ ] No marketing email or SMS has been sent to a child contact. The Mailchimp audience export should contain only parent emails; the Twilio outbound log should show no production sends to any number marked as a player's number.
- [ ] The "Add child" form on softball.html still requires an active Family plan via `/api/managed-minors-create`. Drop in a known non-Family account and confirm 402 is returned.
- [ ] All parental-request log entries from the past 12 months are present in the Notion log with action completed within 30 days.
- [ ] DPAs on file with each vendor in §5.1 cover children's data where the vendor processes it. Today this means: Firebase (Google Cloud COPPA addendum signed or referenced), Twilio (DPA on file, even if SMS is still DRY_RUN). Re-confirm with each vendor's legal page.
- [ ] Review the COPPA section of any new state laws that came into force in the past 12 months (CCPA/CPRA updates, NY SHIELD updates, California AADC litigation status).

Mark the review complete in Notion with date + reviewer initials.
