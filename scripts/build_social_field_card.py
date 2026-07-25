#!/usr/bin/env python3
"""
Build a FIELD-SURFACE social card: chalk-on-dirt or chalk-on-grass.

  python3 scripts/build_social_field_card.py \
      --surface  dirt \
      --eyebrow  "AFTER THE LAST OUT" \
      --headline "More games don't make your player better." \
      --subline  "What they do between games does." \
      --kicker   "Tonight, one line." \
      --outdir   media/social/2026-07-25-field-test \
      --prefix   Between-Games-DIRT --date 2026-07-25

WHY THIS EXISTS (2026-07-25, Coach's off-signature series)
Third direction away from the near-black + gold + golden-hour look that has
become the generic AI-design signature. This one borrows the colours of the
game itself rather than of software: infield dirt or outfield grass, with
chalk-white type and a chalk baseline as the only graphic device.

Gold appears ONLY on the compass mark. That is the point — on the dark cards
gold was doing the heavy lifting, which is exactly what made them read as
generic. Here the surface carries the brand and gold is a signature, not a
fill.

Note the mark switches with the surface: assets/mark-white.png on these dark
fields, because the standard black-element mark disappears against them. Same
rule as choosing the gold or white Higgsfield mark on warm-dark gear.

Sizes: 4x5 FEED 1080x1350 / 9x16 STORY 1080x1920 / 1x1 SQUARE 1080x1080 /
2x3 PIN 1000x1500.
"""
import argparse
import base64
import subprocess
import tempfile
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PROFILE = "/tmp/chrome-social-field"

# Surface palettes. Values sampled to sit in the same warm family as the brand
# without leaning on gold: dirt is a sun-baked infield, grass a cut outfield.
SURFACES = {
    "dirt":  {"base": "#7A5638", "deep": "#5E4029", "chalk": "#F4F1E8", "body": "#EFE7D8"},
    "grass": {"base": "#3C5535", "deep": "#2A3D26", "chalk": "#F4F1E8", "body": "#E4EBDC"},
}

# label -> (w, h, headline, eyebrow, subline, kicker, pad, mark)
SIZES = {
    "4x5-FEED":   (1080, 1350, 128, 31, 42, 31,  92, 84),
    "9x16-STORY": (1080, 1920, 162, 34, 48, 34,  96, 96),
    "1x1-SQUARE": (1080, 1080, 114, 29, 39, 29,  86, 76),
    "2x3-PIN":    (1000, 1500, 126, 30, 41, 30,  84, 80),
}

TEMPLATE = """<!doctype html><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow+Condensed:wght@600;700&family=Barlow:wght@400;500&display=swap" rel="stylesheet">
<style>
  *{{margin:0;padding:0;box-sizing:border-box}}
  html,body{{width:{w}px;height:{h}px;overflow:hidden;background:{base}}}
  .card{{position:relative;width:{w}px;height:{h}px;overflow:hidden;
       padding:{pad}px;background:{base}}}
  /* Surface grain. Layered soft radials plus a fine stipple so the field does
     not read as a flat colour swatch. No photo, so it stays deterministic. */
  .grain{{position:absolute;inset:0;
       background:
         radial-gradient(120% 80% at 22% 12%, rgba(255,255,255,.10), transparent 55%),
         radial-gradient(100% 70% at 84% 88%, {deep} , transparent 60%),
         radial-gradient(circle at 30% 40%, rgba(0,0,0,.10) 0 1px, transparent 1px),
         radial-gradient(circle at 70% 65%, rgba(255,255,255,.06) 0 1px, transparent 1px);
       background-size:auto, auto, 7px 7px, 9px 9px;}}
  /* Chalk baseline: the one graphic device, and the reason this reads as a
     ballfield rather than as a coloured card. */
  .chalk{{position:absolute;left:0;right:0;bottom:{chalkbot}px;height:{chalkh}px;
       background:{chalk};opacity:.85}}
  .chalk2{{position:absolute;left:0;right:0;bottom:{chalkbot2}px;height:{chalkh2}px;
       background:{chalk};opacity:.28}}
  .top{{position:absolute;left:{pad}px;right:{pad}px;top:{pad}px;
       display:flex;align-items:center;gap:{markgap}px}}
  .mark{{width:{mk}px;height:{mk}px;flex:0 0 auto}}
  .eyebrow{{font-family:'Barlow Condensed',sans-serif;font-weight:700;
       text-transform:uppercase;letter-spacing:.28em;color:{chalk};
       font-size:{eb}px;line-height:1;opacity:.85}}
  /* Same self-balancing band as the light builder. */
  .mid{{position:absolute;left:{pad}px;right:{pad}px;
       top:{bandtop}px;bottom:{bandbottom}px;
       display:flex;flex-direction:column;justify-content:center;
       padding-bottom:{lift}px}}
  .headline{{font-family:'Bebas Neue',Impact,sans-serif;text-transform:uppercase;
       color:{chalk};font-size:{hl}px;line-height:.92;letter-spacing:.004em;
       margin-left:-{optical}px;text-shadow:0 2px 18px rgba(0,0,0,.28)}}
  .rule{{width:{rw}px;height:3px;background:{chalk};opacity:.55;
       margin:{rgap}px 0;border-radius:3px}}
  .subline{{font-family:'Barlow',sans-serif;font-weight:400;color:{body};
       font-size:{sl}px;line-height:1.4;max-width:{slw}px;
       text-shadow:0 1px 12px rgba(0,0,0,.30)}}
  .bottom{{position:absolute;left:{pad}px;right:{pad}px;bottom:{pad}px;
       display:flex;align-items:baseline;justify-content:space-between;gap:24px}}
  .kicker{{font-family:'Barlow Condensed',sans-serif;font-weight:700;
       text-transform:uppercase;letter-spacing:.16em;color:{chalk};
       font-size:{kk}px}}
  .footer{{font-family:'Barlow Condensed',sans-serif;font-weight:600;
       letter-spacing:.16em;color:{body};opacity:.85;font-size:{kk}px;
       white-space:nowrap}}
</style>
<div class="card">
  <div class="grain"></div>
  <div class="chalk2"></div>
  <div class="chalk"></div>

  <div class="top">
    <img class="mark" src="data:image/png;base64,{mark}" alt="">
    <div class="eyebrow">{eyebrow}</div>
  </div>

  <div class="mid">
    <div class="headline">{headline}</div>
    <div class="rule"></div>
    <div class="subline">{subline}</div>
  </div>

  <div class="bottom">
    <div class="kicker">{kicker}</div>
    <div class="footer">mygrindapp.com</div>
  </div>
</div>
"""


def render(html: str, w: int, h: int, out: Path) -> None:
    with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False) as fh:
        fh.write(html)
        page = Path(fh.name)
    raw = out.with_suffix(".raw.png")
    raw.unlink(missing_ok=True)
    cmd = [
        CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
        "--force-device-scale-factor=2", f"--window-size={w},{h}",
        "--no-first-run", "--no-default-browser-check", "--disable-extensions",
        f"--user-data-dir={PROFILE}", f"--screenshot={raw}", f"file://{page}",
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        deadline = time.time() + 60
        last, stable = -1, None
        while time.time() < deadline:
            if proc.poll() is not None:
                break
            if raw.exists():
                sz = raw.stat().st_size
                if sz > 0 and sz == last:
                    if stable and time.time() - stable >= 1.0:
                        break
                else:
                    last, stable = sz, time.time()
            time.sleep(0.2)
    finally:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=8)
            except subprocess.TimeoutExpired:
                proc.kill()
    if not raw.exists() or raw.stat().st_size == 0:
        raise RuntimeError(f"screenshot not produced for {out.name}")
    from PIL import Image
    img = Image.open(raw).convert("RGB")
    if img.size != (w, h):
        img = img.resize((w, h), Image.LANCZOS)
    img.save(out, "PNG", optimize=True)
    raw.unlink(missing_ok=True)
    page.unlink(missing_ok=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--surface", default="dirt", choices=sorted(SURFACES))
    ap.add_argument("--eyebrow", required=True)
    ap.add_argument("--headline", required=True)
    ap.add_argument("--subline", required=True)
    ap.add_argument("--kicker", default="Tonight, one line.")
    ap.add_argument("--outdir", required=True)
    ap.add_argument("--prefix", required=True)
    ap.add_argument("--date", required=True)
    args = ap.parse_args()

    outdir = Path(args.outdir)
    if not outdir.is_absolute():
        outdir = REPO / outdir
    outdir.mkdir(parents=True, exist_ok=True)

    pal = SURFACES[args.surface]
    # mark-on-dark.png = cream elements + gold, transparent background. This is
    # the one for dark surfaces. Do NOT use mark-white.png here despite the
    # name: that file is the black+gold mark on an OPAQUE white square, which
    # pastes a white box onto the dirt. assets/mark.png (black elements) also
    # disappears against these fields.
    mark_b64 = base64.b64encode((REPO / "assets" / "mark-on-dark.png").read_bytes()).decode()

    for label, (w, h, hl, eb, sl, kk, pad, mk) in SIZES.items():
        band_top = pad + max(mk, eb) + int(mk * 0.55)
        band_bottom = pad + kk + int(kk * 1.5)
        html = TEMPLATE.format(
            w=w, h=h, pad=pad, mark=mark_b64, mk=mk,
            eyebrow=args.eyebrow, headline=args.headline,
            subline=args.subline, kicker=args.kicker,
            hl=hl, eb=eb, sl=sl, kk=kk,
            base=pal["base"], deep=pal["deep"], chalk=pal["chalk"], body=pal["body"],
            bandtop=band_top, bandbottom=band_bottom, lift=int(h * 0.025),
            rw=int(hl * 0.62), rgap=int(hl * 0.20),
            slw=int((w - 2 * pad) * 0.94),
            markgap=int(mk * 0.26), optical=max(2, int(hl * 0.035)),
            chalkbot=int(h * 0.115), chalkh=max(3, int(h * 0.0035)),
            chalkbot2=int(h * 0.145), chalkh2=max(2, int(h * 0.0018)),
        )
        out = outdir / f"{args.prefix}-{label}-{w}x{h}-{args.date}.png"
        render(html, w, h, out)
        print(f"  wrote {out.relative_to(REPO)}")


if __name__ == "__main__":
    main()
