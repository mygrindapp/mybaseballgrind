// ═══════════════════════════════════════════════════════════
// MyGrind — lib/email-digest.js (Phase 7b V1.5)
// ───────────────────────────────────────────────────────────
// Pure rendering for the parent weekly digest email. Given a
// parent email + a list of {request, response} feedback items
// from the past 7 days, builds a warm-dark branded HTML email
// + a plain-text fallback + a subject line.
//
// Data is grouped by player so a parent with multiple kids
// gets one email that lists each player's coach feedback for
// the week.
//
// No I/O here — the cron handler reads from feedback-store
// then passes the items in. Keeps this testable.
// ═══════════════════════════════════════════════════════════

const APP_URL = 'https://www.mygrindapp.com';
const APP_LOGO = 'https://www.mygrindapp.com/assets/logo-web.png';

// Brand colors (Warm Dark — keep in sync with mg-config.js / BRAND_SYSTEM.md)
const C = {
  bg:        '#1A1410',
  surface:   '#221813',
  border:    '#3a2a1f',
  gold:      '#D4A574',
  goldDeep:  '#C9A84C',
  cream:     '#F5EDE0',
  bronze:    '#8B6F47',
  mute:      '#9a8b78',
};

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function firstName(full) {
  return String(full || '').trim().split(/\s+/)[0] || '';
}

// Coach reply page (coach-reply.html) submits chips as objects:
//   { key: 'rotation', label: 'Good rotation', detail: '…' }
// Older/test data may include plain strings. Always normalize to a
// human-readable label so the digest never renders [object Object].
function chipLabel(c) {
  if (!c) return '';
  if (typeof c === 'string') return c;
  if (typeof c === 'object') return c.label || c.text || c.name || c.key || '';
  return '';
}
function chipDetail(c) {
  if (!c || typeof c !== 'object') return '';
  return c.detail || '';
}

// Group items by player name. Player name is the canonical
// identity in the digest because parents think in players,
// not in feedback request IDs.
function groupByPlayer(items) {
  const groups = new Map();
  for (const it of items) {
    const name = (it.player?.name || 'Your player').trim();
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(it);
  }
  // Newest first within each group
  for (const arr of groups.values()) {
    arr.sort((a, b) => new Date(b.response?.respondedAt || b.createdAt) - new Date(a.response?.respondedAt || a.createdAt));
  }
  return groups;
}

function renderResponseBlock(item) {
  const r = item.response || {};
  const chips = Array.isArray(r.chips) ? r.chips : [];
  const comment = (r.comment || '').trim();
  const coach = r.coachDisplayName || item.coach?.name || 'Coach';
  const focus = item.focus || 'practice';
  const respondedAt = r.respondedAt
    ? new Date(r.respondedAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    : '';

  const chipsHtml = chips.length
    ? `<div style="margin-top:8px;line-height:1.7;">
         ${chips.map(c => {
           const label = chipLabel(c);
           const detail = chipDetail(c);
           if (!label) return '';
           const detailHtml = detail
             ? `<span style="color:${C.cream};font-weight:400;opacity:0.85;"> · ${escapeHtml(detail)}</span>`
             : '';
           return `<span style="display:inline-block;background:${C.bg};border:1px solid ${C.border};color:${C.gold};padding:4px 10px;border-radius:999px;font-size:13px;margin:2px 4px 2px 0;font-weight:600;">${escapeHtml(label)}${detailHtml}</span>`;
         }).filter(Boolean).join('')}
       </div>`
    : '';

  const commentHtml = comment
    ? `<p style="margin:12px 0 0;color:${C.cream};font-size:15px;line-height:1.55;font-style:italic;">"${escapeHtml(comment)}"</p>`
    : '';

  return `
    <div style="background:${C.surface};border:1px solid ${C.border};border-radius:12px;padding:16px 18px;margin:0 0 12px;">
      <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px;">
        <div style="color:${C.gold};font-size:13px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">${escapeHtml(focus)}</div>
        <div style="color:${C.mute};font-size:12px;">${escapeHtml(respondedAt)}</div>
      </div>
      ${chipsHtml}
      ${commentHtml}
      <div style="color:${C.mute};font-size:12px;margin-top:10px;">— ${escapeHtml(coach)}</div>
    </div>
  `;
}

function renderPlayerSection(playerName, items) {
  const blocks = items.map(renderResponseBlock).join('');
  const count = items.length;
  return `
    <div style="margin:24px 0 8px;">
      <h2 style="color:${C.cream};font-size:20px;font-weight:600;margin:0 0 4px;">${escapeHtml(playerName)}</h2>
      <div style="color:${C.mute};font-size:13px;margin:0 0 14px;">${count} coach ${count === 1 ? 'note' : 'notes'} this week</div>
      ${blocks}
    </div>
  `;
}

// ─── PUBLIC: build the full email payload ────────────────
// `unsubscribeUrl` (optional but recommended) is the per-parent HMAC-
// validated /api/digest-unsubscribe URL. When provided, the footer
// renders an Unsubscribe link in both HTML + plain-text payloads
// (CAN-SPAM compliance + parent trust). The caller (api/cron/weekly-
// digest.js) builds the URL with the HMAC token; kept out of this
// pure-render function so buildDigest stays I/O-free + testable.
export function buildDigest({ parentEmail, parentName, items, unsubscribeUrl }) {
  const groups = groupByPlayer(items || []);
  const playerNames = [...groups.keys()];
  const totalItems = (items || []).length;

  // Subject pivots on count + player names so it doesn't feel like spam
  let subject;
  if (totalItems === 0) {
    subject = 'A quiet week on MyGrind';
  } else if (playerNames.length === 1) {
    subject = `This week with ${playerNames[0]} on MyGrind`;
  } else {
    subject = `This week's coaching for your players on MyGrind`;
  }

  const greeting = parentName ? `Hi ${escapeHtml(firstName(parentName))},` : 'Hi there,';

  const headerHtml = `
    <div style="text-align:center;padding:24px 24px 8px;">
      <img src="${APP_LOGO}" alt="MyGrind" width="180" style="max-width:60%;height:auto;display:inline-block;" />
    </div>
    <div style="text-align:center;color:${C.mute};font-size:12px;letter-spacing:0.08em;text-transform:uppercase;padding:0 24px 16px;">The Weekly Check-In</div>
  `;

  const sectionsHtml = totalItems === 0
    ? `
      <div style="background:${C.surface};border:1px solid ${C.border};border-radius:12px;padding:20px;margin:0 0 12px;">
        <p style="margin:0 0 8px;color:${C.cream};font-size:15px;line-height:1.6;">No coach feedback came through this week — that's normal. Some weeks are quieter than others.</p>
        <p style="margin:0;color:${C.mute};font-size:14px;line-height:1.6;">If your player is logging reps in the app, you can see their journal anytime in your dashboard.</p>
      </div>
    `
    : [...groups.entries()].map(([name, arr]) => renderPlayerSection(name, arr)).join('');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${C.bg};color:${C.cream};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:${C.bg};">
    ${headerHtml}
    <div style="padding:0 24px 32px;">
      <p style="color:${C.cream};font-size:16px;line-height:1.55;margin:8px 0 4px;">${greeting}</p>
      <p style="color:${C.mute};font-size:14px;line-height:1.55;margin:0 0 8px;">Here's what came through from coaches and trainers this past week.</p>

      ${sectionsHtml}

      <div style="text-align:center;margin:28px 0 8px;">
        <a href="${APP_URL}/signup.html" style="display:inline-block;background:${C.goldDeep};color:${C.bg};text-decoration:none;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;padding:12px 22px;border-radius:8px;font-size:14px;">Open the app →</a>
      </div>

      <p style="color:${C.mute};font-size:12px;line-height:1.55;margin:24px 0 0;text-align:center;">
        You're getting this because your player connected with a coach through MyGrind.<br>
        Forwarded to you? <a href="${APP_URL}" style="color:${C.gold};">Learn more at mygrindapp.com</a>.
      </p>
      <p style="color:${C.mute};font-size:11px;line-height:1.4;margin:8px 0 0;text-align:center;">
        Sent by MyGrind • support@mygrindapp.com
        ${unsubscribeUrl ? `<br><a href="${unsubscribeUrl}" style="color:${C.mute};text-decoration:underline;">Unsubscribe</a> from the weekly digest` : ''}
      </p>
    </div>
  </div>
</body>
</html>`;

  // Plain-text fallback
  const textLines = [
    `${greeting.replace(/<[^>]+>/g, '')}`,
    `Here's what came through from coaches and trainers this past week.`,
    ''
  ];
  if (totalItems === 0) {
    textLines.push("No coach feedback came through this week — that's normal. Some weeks are quieter than others.");
  } else {
    for (const [name, arr] of groups.entries()) {
      textLines.push(`— ${name} (${arr.length} ${arr.length === 1 ? 'note' : 'notes'}) —`);
      for (const it of arr) {
        const r = it.response || {};
        textLines.push(`• ${(it.focus || 'practice').toUpperCase()}`);
        if (Array.isArray(r.chips) && r.chips.length) {
          const chipText = r.chips.map(c => {
            const label = chipLabel(c);
            const detail = chipDetail(c);
            return detail ? `${label} (${detail})` : label;
          }).filter(Boolean).join(' · ');
          if (chipText) textLines.push(`  ${chipText}`);
        }
        if (r.comment) textLines.push(`  "${r.comment}"`);
        textLines.push(`  — ${r.coachDisplayName || it.coach?.name || 'Coach'}`);
        textLines.push('');
      }
    }
  }
  textLines.push(`Open the app: ${APP_URL}/signup.html`);
  textLines.push('');
  textLines.push('Sent by MyGrind • support@mygrindapp.com');
  if (unsubscribeUrl) {
    textLines.push('');
    textLines.push(`Unsubscribe from the weekly digest: ${unsubscribeUrl}`);
  }

  return { subject, html, text: textLines.join('\n') };
}
