# MyGrind Brand System

This is the canonical visual + interaction system for every MyGrind web surface. Every new page (about, features, pricing, blog, marketing pages, etc.) should pull from these tokens so the brand reads as one consistent product.

The first reference implementation is **`index.html`** (the pre-launch landing page). Read that file alongside this doc to see the patterns in context.

When this doc and the code disagree, the code wins — but please update this doc to match.

---

## Brand voice (per CLAUDE.md)

- **Use:** investment, support, peace of mind, growth.
- **Avoid:** grind harder, elite, beast mode.
- **Tone:** parent-friendly, no-pressure, trust-first.

---

## Color tokens

Define these as CSS custom properties on `:root` for every page.

**The MyGrind canonical palette is WARM near-black + gold** (leather / gold-leaf / heritage tone), unified across every surface on 2026-06-06. Do not introduce neutral/cool darks (`#050505`, `#0A0A0A`, `#141414`, `#1A1A1A`) — those are the old pre-unification values and have been retired.

| Token | Hex | Use |
|---|---|---|
| `--gold` | `#C9A84C` | Primary brand accent — buttons, gold headlines, borders, eyebrow accents |
| `--gold-light` | `#E0BC60` | Hover state for gold elements |
| `--gold-bright` | `#FFD874` | The bright peak in shimmer gradients on the gold finale (marketing pages only) |
| `--gold-dark` | `#8F7A36` | The dark edges in gold gradients |
| `--black` | `#181614` | Page background (warm near-black) |
| `--dark` | `#1E1A17` | Form/card primary surface |
| `--card` | `#231F1C` | Card backgrounds (slightly lighter than form) |
| `--card2` | `#2A2622` | Raised / secondary card surface |
| `--border` | `#3D3530` | Default borders on cards/inputs |
| `--grey` | `#A89880` | Muted/secondary text (warm) |
| `--light` | `#D4C8BC` | Body copy on dark surfaces (warm) |
| `--white` | `#F5F0EB` | Headlines, primary text (warm white) |
| `--red` | `#C0392B` | Error states (use `#E57373` for error message text on dark bg for contrast) |

---

## Typography

Three core Google Fonts, loaded together. **Always `preconnect` first** so fonts paint fast (avoids the flash of unstyled text that reads as "cheap"):

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow+Condensed:wght@400;600;700;800&family=Barlow:wght@300;400;500&display=swap" rel="stylesheet">
```

A fourth face, **Lora** (italic), is loaded *only in the journal app* (`softball.html`) for editorial quote text — `font-family: 'Lora', Georgia, serif`. **Do not load Inter** — it was removed 2026-06-06 (it only ever sat unused at the tail of a system-font fallback chain and downloaded for nothing).

| Family | Use | Weight | Notes |
|---|---|---|---|
| **Bebas Neue** | Display headlines | 400 | Tall condensed all-caps. Use `clamp(44px, 9vw, 92px)` for hero, `line-height: 1.05` |
| **Barlow Condensed** | UI labels, eyebrows, button labels, chips, footer | 400 / 600 / 700 / 800 | Letter-spacing 2–6px, uppercase |
| **Barlow** | Body copy, form inputs, descriptions | 300 / 400 / 500 | Default body 300, `clamp(15px, 1.6vw, 18px)`, line-height 1.55 |

### Standard size/weight pairings

- **Hero headline:** Bebas Neue 400, `clamp(44px, 9vw, 92px)`, line-height 1.05
- **Eyebrow:** Barlow Condensed 800, 12px, letter-spacing 6px, uppercase, gold
- **Chip / form label / footer:** Barlow Condensed 700, 11–14px, letter-spacing 2.5–4px, uppercase
- **Body:** Barlow 300, `clamp(15px, 1.6vw, 18px)`, line-height 1.55, `--light` color
- **Form input value:** Barlow 400, 16px (16px is the iOS no-zoom threshold — never go below)

---

## Atmospheric background stack

Four fixed layers behind all content (`z-index: 0`, `pointer-events: none`). All MyGrind pages should have these for visual consistency.

1. **`.bg-diamond`** — repeating 45° gold pinstripes at 4% opacity, 32px gap. The "MyGrind diamond pattern."
2. **`.bg-streaks`** — diagonal gold gradient that drifts on a 14s loop (`drift` keyframes). Subtle kinetic energy.
3. **`.bg-glow`** — large radial gold glow (~1100px) centered ~28% from top. Breathes on a 6s loop (`breathe` keyframes).
4. **`.bg-vignette`** — soft black radial darkening corners.

Keep the stacking order as listed: diamond at the bottom, vignette on top.

---

## Animation curves & timing

| Curve | Use | Bezier |
|---|---|---|
| **Smooth entrance (out-quint)** | Big elements like the logo zoom — buttery, decisive | `cubic-bezier(0.16, 1, 0.3, 1)` |
| **Bouncy pop (out-back)** | Small "pop" elements like the sport chip | `cubic-bezier(0.34, 1.56, 0.64, 1)` |
| **Standard fade-up** | Standard reveals — translate-Y from 18px → 0 + opacity 0 → 1 | `ease-out 0.7–0.8s` |
| **Breathing pulse** | Ambient gold glows on logos, chips, buttons | `4–6s ease-in-out infinite` |

### Critical performance rule

**Never run `filter: drop-shadow()` during a `transform: scale()` animation on the same element.** It forces re-rasterization every frame and produces choppy motion. Apply the filter only AFTER the entrance lands (separate keyframe ramps it in). See `.logo-wrap.show img` in `index.html`.

For elements that scale, also set:
```css
will-change: transform, opacity;
backface-visibility: hidden;
-webkit-backface-visibility: hidden;
```

---

## Component patterns

### Form card (dark glass)
Used for any input grouping. Backdrop-blur on a dark translucent surface.

```css
background: rgba(20, 20, 20, 0.65);
border: 1px solid var(--border);
border-radius: 4px;
padding: 22px;
backdrop-filter: blur(8px);
-webkit-backdrop-filter: blur(8px);
box-shadow: 0 12px 60px rgba(0,0,0,0.4), 0 0 0 1px rgba(201,168,76,0.05) inset;
```

### Gold button (primary CTA)
```css
background: var(--gold);
color: var(--black);
font-family: 'Barlow Condensed', sans-serif;
font-weight: 800;
letter-spacing: 2px;
text-transform: uppercase;
padding: 14px 22px;
border: 1px solid var(--gold);
border-radius: 3px;
```
Hover: brighten to `--gold-light`, gold halo `box-shadow`.
Idle pulse (delayed start): `btnPulse 2.6s ease-in-out infinite` — gentle expanding gold halo.

### Gold pill chip (audience callout / feature flag)
```css
display: inline-block;
padding: 8px 20px 9px;
border: 1px solid rgba(201,168,76, 0.6);
border-radius: 99px;
background: rgba(201,168,76, 0.08);
font-family: 'Barlow Condensed', sans-serif;
font-size: 12px;
font-weight: 700;
letter-spacing: 4px;
text-transform: uppercase;
color: var(--gold);
```
Animates in with `chipPop` (bouncy) + ongoing `chipGlow` halo pulse.

### Eyebrow with hairline rules
Small gold all-caps text with horizontal lines on either side.

```css
.eyebrow { position: relative; padding: 0 16px; }
.eyebrow::before,
.eyebrow::after {
  content: '';
  position: absolute;
  top: 50%;
  width: 28px;
  height: 1px;
  background: var(--gold);
  opacity: 0.6;
}
.eyebrow::before { right: 100%; }
.eyebrow::after  { left: 100%; }
```

### Inline error message
For form validation errors / blocked submissions.

```css
.form-error {
  display: none;
  font-family: 'Barlow', sans-serif;
  font-size: 13px;
  color: #E57373;
  text-align: center;
  margin-top: 12px;
  line-height: 1.5;
  padding: 10px 12px;
  background: rgba(192,57,43,0.10);
  border: 1px solid rgba(192,57,43,0.30);
  border-radius: 3px;
}
.form-error.show { display: block; }
```

---

## Cinematic entrance choreography

For hero / landing pages, stagger reveals so each beat earns its moment. The pattern below is the canonical opening sequence — adapt timing to fit content but keep the order.

1. **Eyebrow** fades in first (0.15s)
2. **Headline** types out character-by-character (~95ms ± 50ms jitter for hunt-and-peck rhythm)
3. **Gold accent underline** draws across (1s after typewriter ends)
4. **Subhead** fades in (350ms after underline)
5. **Form / CTA** lifts in (650ms after underline)
6. **Footer** fades in (950ms after underline)
7. **Logo enters last** — slow 3.2s zoom from `scale(0.05)` → `scale(1.0)` using out-quint curve (~1550ms after underline)
8. **Gold radial burst** flashes from behind logo as it lands at full scale
9. **Sport chip** pops in 150ms after logo settles — final beat that punctuates everything

The logo is the climax, not the opener. Don't put the logo at the start of the cascade — the experience is the reveal of the brand mark, not the brand mark hovering passively while text loads.

---

## Form behavior conventions

### Mailchimp embedded form pattern
Native HTML form posting to a hidden iframe so the page never navigates away. JS swaps form for inline thank-you on success.

```html
<form action="https://...list-manage.com/subscribe/post?u=...&id=..." method="post" target="mc_iframe">
  <!-- visible inputs -->
  <input type="hidden" name="tags" value="...">  <!-- audience segmentation -->
  <div class="hp" aria-hidden="true">             <!-- honeypot -->
    <input type="text" name="b_..._..." tabindex="-1" value="" autocomplete="off">
  </div>
</form>
<iframe name="mc_iframe" style="display:none;"></iframe>
```

### Spam protection layers (canonical for any signup form)

1. **Honeypot field** — `name="b_..._..."` from Mailchimp, hidden via `.hp` class far off-screen. Bots fill it; humans don't.
2. **HTML5 native validation** — `type="email"` + `required` catches malformed addresses before submit.
3. **Disposable domain blocklist** — JS check against known temp-mail providers (~18 domains in current list). Block client-side and show error.
4. **Submission cooldown** — track timestamps in memory, reject if 3+ submissions in 60 seconds.
5. **Mailchimp double opt-in** (Audience setting) — confirms email is real and that the user wants the list. **The single most important defense.** Always enabled.

If spam survives all five layers post-launch, add Cloudflare Turnstile (invisible CAPTCHA, free, ~30 lines).

---

## Responsive rules

- Use `clamp()` for fluid type instead of breakpoint sizes
- Mobile breakpoint: `@media (max-width: 600px)` for layout stacking
- Form rows: `flex-direction: column` on mobile so input + button stack
- Logo: 560px desktop → 380px mobile (use `max-width: 92vw`)
- Chip: keep one line on mobile by tightening letter-spacing if needed
- Always test at 375px viewport width (iPhone SE)

---

## Accessibility

- **Honor `prefers-reduced-motion: reduce`** — disable all animations, show all elements immediately, skip the typewriter:
  ```css
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation: none !important; }
    .logo-wrap, .subhead, .form-section, footer {
      opacity: 1 !important; transform: none !important;
    }
  }
  ```
  And in JS, check `window.matchMedia('(prefers-reduced-motion: reduce)').matches` before starting any text-typing animation.
- All text must pass WCAG AA contrast on `--black` (white, `--light`, and `--gold` all pass)
- Form inputs must have visible focus states: `border-color: var(--gold)` + `box-shadow: 0 0 0 3px rgba(201,168,76,0.15)`
- Use `aria-live="polite"` on submit confirmation regions
- Cursor (typewriter pen-stroke) is decorative — don't put text inside it

---

## File organization

- `index.html` — canonical reference for atmospheric layers, fonts, animation timing, form pattern
- `assets/logo.png` — full master horizontal logo (DARKMODE variant for dark backgrounds)
- `assets/logo-web.png` — web-resized version (920px wide, ~42KB)
- `assets/favicon.png` — 32×32 favicon
- `assets/apple-touch-icon.png` — 128×128 touch icon
- `assets/mark.png` — compass+ball monogram only (used for tighter contexts)

When the brand assets are referenced inline (e.g., as base64 data URIs for guaranteed rendering), the master files in `assets/` remain the source of truth.

---

## Updates to this doc

When adding a new component or pattern to the codebase, update this doc in the same PR. The brand drifts when the doc and the code disagree.
