# Adding a New Sport to MyGrind

This is the recipe for plugging a new sport (football, volleyball, basketball, soccer, lacrosse, etc.) into the MyGrind app. The architecture was built sport-agnostic in **Phase 1 (2026-05-06)** specifically so this stays a ~15-minute job per sport.

If you're following this for the first time, read [`STATUS.md`](STATUS.md) for context on what's already shipped, then dive in.

---

## TL;DR — 5 steps, ~15 minutes per sport

1. Add a `SPORTS` config entry in `softball.html`
2. Add a `[data-sport="..."]` CSS variable block
3. (Optional, Phase 2) Author content bundle: drills, calendar, journal prompts
4. (Optional, Phase 3) Build a marketing landing page at `/sport-name`
5. Deploy

The first two steps unlock theming for the new sport. The last two are content/marketing work — whenever the sport is ready to launch.

---

## Step 1 — Add a `SPORTS` config entry

In **`softball.html`**, find the `var SPORTS = {` block near the top (around line 95) and add an entry:

```js
var SPORTS = {
  baseball:   { id: 'baseball',   label: 'Baseball',   slug: 'baseball',
                emoji: '⚾', accent: '#C9A84C', accentRgb: '201, 168, 76' },
  softball:   { id: 'softball',   label: 'Softball',   slug: 'softball',
                emoji: '🥎', accent: '#D4547A', accentRgb: '212, 84, 122' },
  both:       { id: 'both',       label: 'Baseball/Softball', slug: 'baseball/softball',
                emoji: '⚾🥎',  accent: '#C9A84C', accentRgb: '201, 168, 76' },

  // ↓ NEW SPORT ADDED HERE
  football:   { id: 'football',   label: 'Football',   slug: 'football',
                emoji: '🏈',
                accent:    '#7B3F00',          // your sport's primary brand color (hex)
                accentRgb: '123, 63, 0' },     // SAME color as comma-separated RGB triple
};
```

**Required fields:**

| Field | Type | Notes |
|---|---|---|
| `id` | string | Internal sport ID. Lowercase, no spaces. Becomes the value of `data-sport` and the `?sport=X` URL param. |
| `label` | string | Display name shown to users (e.g., "Football"). Used by `applyTitleAndMeta()` in `<title>` and meta tags. |
| `slug` | string | Lowercase URL/SEO slug. Used in meta description ("the football journal app"). |
| `emoji` | string | A single ball/sport emoji. **Important:** use a single character — combos like `⚾🥎` are special-cased only for "both". |
| `accent` | string | Primary brand color hex for this sport. Replaces gold/pink. |
| `accentRgb` | string | The same color as a `R, G, B` triple (no parens, no alpha). Used in `rgba(var(--accent-rgb), 0.X)` patterns. |

**Convert any hex to its RGB triple** in 5 sec at [colorhexa.com](https://www.colorhexa.com) or via JS console: `parseInt('7B3F00'.match(/.{2}/g).map(h=>parseInt(h,16)).join(','), 10) /* breaks; use array */`. Example: `#7B3F00` → `123, 63, 0`.

---

## Step 2 — Add the `[data-sport="..."]` CSS block

In `softball.html`, find the `:root { --gold: #C9A84C; ... }` block (around line 270) and add a new selector below the softball one:

```css
:root {
  /* baseball is the default — gold palette */
  --gold: #C9A84C;
  --gold-light: #E0BC60;
  --gold-dark: #8F7A36;
  --accent-rgb: 201, 168, 76;
  /* ... other tokens ... */
}

[data-sport="softball"] {
  --gold: #D4547A;
  --gold-light: #E87FA0;
  --gold-dark: #A03060;
  --accent-rgb: 212, 84, 122;
}

/* ↓ NEW SPORT ADDED HERE */
[data-sport="football"] {
  --gold:        #7B3F00;
  --gold-light:  #A05F1E;     /* lighter shade — for hover/highlight */
  --gold-dark:   #4F2700;     /* darker shade  — for borders/text-on-light */
  --accent-rgb:  123, 63, 0;
}
```

For `--gold-light` / `--gold-dark`, just lighten / darken your accent by ~15-20% via any color picker. They're used for hover states and borders.

**That's it for the dashboard.** The new sport now themes correctly. Test by loading `https://www.mygrindapp.com/softball.html?sport=football`.

---

## Step 3 — Wire signup.html so users can pick the sport

In `signup.html`, find the sport-tile grid on Screen 3 (around line 2077, near the existing baseball/softball/both buttons):

```html
<button type="button" class="sport-tile" id="sp_football"
        onclick="selectFamilySport('football')">
  <div class="sport-tile-icon">🏈</div>
  <div class="sport-tile-name">Football</div>
</button>
```

Then update `restoreFamilyFields()` (around line 3186) to include the new sport's ID in the visual-clear array:

```js
['sp_baseball', 'sp_softball', 'sp_both', 'sp_football'].forEach(...)
```

That's it for signup-side wiring. The user picks → `state.familySport = 'football'` → handed off to `softball.html` via existing URL param logic.

---

## Step 4 — (Optional, Phase 2) Author the content bundle

Sport-specific drills, training calendars, journal prompts go in `data/sports/<sport>.json`. The dashboard reads the active sport's bundle at runtime.

**This is content authoring work — no code change.** Drag in:

- Daily / weekly training plans
- Position list (QB, WR, etc. for football; libero, setter, etc. for volleyball)
- Drill names with descriptions
- Journal prompts
- Season calendar

Use `data/sports/baseball.json` (when it exists — Phase 2) as a template. Until you author this, the new sport gets generic content (whatever is currently hardcoded in `softball.html`'s training-plan arrays).

---

## Step 5 — (Optional, Phase 3) Build a marketing landing page

Create `<sport>.html` at the repo root (e.g., `football.html`). Clone the structure from a simple landing page — sport-specific hero, testimonials, value prop. Final CTA links to:

```
/signup.html?sport=football
```

This pre-fills `familySport=football` so the user skips the sport question on Screen 3.

This unlocks SEO (search "football training app" → lands on `/football`) and dedicated marketing (run football-only ads to that URL).

---

## Quick checklist when adding a sport

- [ ] Step 1 — `SPORTS` config entry in `softball.html`
- [ ] Step 2 — `[data-sport="X"]` CSS block in `softball.html`
- [ ] Step 3 — Sport tile in `signup.html` Screen 3
- [ ] Smoke test: load `softball.html?sport=X` → palette, emoji, title all sport-aware
- [ ] Optional Step 4 — Content bundle in `data/sports/X.json`
- [ ] Optional Step 5 — Landing page at `/X.html`
- [ ] Update `next_session_start.md` if launching a new sport
- [ ] Deploy: `npx vercel --prod --yes` from repo root

---

## Existing sports (active as of 2026-05-06)

| Sport | Status | Accent | Emoji |
|---|---|---|---|
| **Baseball** | ✅ Live | `#C9A84C` (gold) | ⚾ |
| **Softball** | ✅ Live | `#D4547A` (pink) | 🥎 |
| **Both** | ✅ Live (toggle) | gold (defaults to baseball view) | ⚾🥎 |
| **Football** | ✅ Live (2026-05-18) | `#B86F2A` (pigskin brown) | 🏈 |
| Volleyball | 🚧 Coming soon | suggested `#3B82F6` | 🏐 |
| Basketball | 🚧 Coming soon | suggested `#E36B22` | 🏀 |
| Soccer | 🚧 Coming soon | suggested `#16A34A` | ⚽ |

The "Coming soon" strip on signup.html Screen 0 surfaces this list to users — update it when launching a new sport (file: `signup.html`, search for `coming-soon-strip`).

---

## What WON'T break per-sport

- **Pricing** — same Stripe products serve every sport. No changes needed.
- **Webhook** — `api/stripe-webhook.js` is sport-agnostic (it just records subscription state).
- **Coach feedback loop** — magic-link / SMS flow works the same regardless of sport.
- **Account, journal, streak, stats** — all sport-agnostic at the data layer.

## What WILL need attention per-sport

- **Sport-specific content** (drills, calendar, prompts) — Phase 2 authoring.
- **Position list** (QB/WR/LB for football vs. C/SS/CF for baseball) — Phase 2 if you want sport-correct positions.
- **Coach credibility** — Coach Young is the baseball/softball authority. Other sports need a sport-specific advisor's name + photo on the About page when the sport launches publicly.

That's it. New sport in 15 minutes of code + however long the content takes.
