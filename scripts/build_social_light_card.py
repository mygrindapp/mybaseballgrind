#!/usr/bin/env python3
"""
Build a LIGHT, type-forward MyGrind social card. No photo.

  python3 scripts/build_social_light_card.py \
      --eyebrow  "AFTER THE LAST OUT" \
      --headline "More games don't make your player better." \
      --subline  "What they do between games does." \
      --kicker   "Tonight, one line." \
      --outdir   media/social/2026-07-25-light-test \
      --prefix   Between-Games-LIGHT --date 2026-07-25

WHY THIS EXISTS (2026-07-25, Coach's call)
Coach: "a lot of apps and websites are looking the same with the same claude
gold and black. It seems this is a signature for Claude web based."

He is right. Near-black background + gold accent + golden-hour photo is the
house style AI-generated design converges on, and both existing card builders
(build_social_overlay_card.py, build_social_action_card.py) produce exactly
that shape. In a feed it reads as generic.

This builder is the deliberate opposite:
  * CREAM background (#F7F4EF) — the same light theme the product actually
    ships as its default, so it is more on-brand than the dark cards were.
  * Near-black Bebas Neue headline doing the work. No photo at all.
  * Gold demoted to a hairline rule and the kicker only, never a fill.
  * A light card is also the rarest thing in a photo-heavy sports feed, so it
    breaks the scroll on contrast rather than on another sunset.

Fonts are the website system (Bebas Neue display, Barlow Condensed labels,
Barlow body) — correct for a marketing surface. Playfair stays reserved for
the QOTD "Today's Grind" cards.

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
PROFILE = "/tmp/chrome-social-light"

# label -> (w, h, headline, eyebrow, subline, kicker, pad, mark)
# Type scales with the canvas: a 9:16 story rendered at feed-size type left
# ~500px of void above the headline, which reads as a mistake rather than as
# whitespace. Hence 168px on the story vs 116px on the square.
#
# Vertical placement is NOT hard-coded per ratio. Two earlier attempts failed:
# space-between stranded huge voids on tall canvases, and fixed midtop
# percentages balanced the 4:5 while leaving the square bottom-heavy and the
# story top-heavy — and they would drift again on any headline whose line count
# differs. The headline block is now centred inside the band left between the
# top lockup and the bottom row, with a small optical lift, so it self-balances
# for any copy length.
SIZES = {
    "4x5-FEED":   (1080, 1350, 132, 31, 43, 31,  92, 84),
    "9x16-STORY": (1080, 1920, 168, 34, 50, 34,  96, 96),
    "1x1-SQUARE": (1080, 1080, 116, 29, 40, 29,  86, 76),
    "2x3-PIN":    (1000, 1500, 130, 30, 42, 30,  84, 80),
}

TEMPLATE = """<!doctype html><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow+Condensed:wght@600;700&family=Barlow:wght@400;500&display=swap" rel="stylesheet">
<style>
  *{{margin:0;padding:0;box-sizing:border-box}}
  html,body{{width:{w}px;height:{h}px;overflow:hidden;background:#F7F4EF}}
  /* Three zones pinned explicitly. space-between was tried first and stranded
     huge voids on the tall ratios, so the headline block is placed by midtop
     instead of being left to divide the leftover height. */
  .card{{position:relative;width:{w}px;height:{h}px;overflow:hidden;
       background:#F7F4EF;padding:{pad}px}}
  /* Hairline gold frame: the only large-area gold on the card. */
  .frame{{position:absolute;inset:{inset}px;border:1.5px solid #C9A84C;
       opacity:.45;pointer-events:none}}
  .top{{position:absolute;left:{pad}px;right:{pad}px;top:{pad}px;
       display:flex;align-items:center;gap:{markgap}px}}
  /* Self-balancing band: spans from just under the top lockup to just above
     the bottom row, and centres the headline block inside it. padding-bottom
     is the optical lift — a hero block reads centred when it sits slightly
     ABOVE true centre. */
  .mid{{position:absolute;left:{pad}px;right:{pad}px;
       top:{bandtop}px;bottom:{bandbottom}px;
       display:flex;flex-direction:column;justify-content:center;
       padding-bottom:{lift}px}}
  .bottom{{position:absolute;left:{pad}px;right:{pad}px;bottom:{pad}px}}
  .mark{{width:{mk}px;height:{mk}px;flex:0 0 auto}}
  .eyebrow{{font-family:'Barlow Condensed',sans-serif;font-weight:700;
       text-transform:uppercase;letter-spacing:.30em;color:#8F7A36;
       font-size:{eb}px;line-height:1}}
  /* Optical fix: Bebas carries noticeable side bearing, so a nudge left keeps
     the cap stems flush with the eyebrow and footer above and below it. */
  .headline{{font-family:'Bebas Neue',Impact,sans-serif;text-transform:uppercase;
       color:#14120F;font-size:{hl}px;line-height:.92;letter-spacing:.004em;
       margin-left:-{optical}px}}
  .rule{{width:{rw}px;height:3px;background:#C9A84C;margin:{rgap}px 0;
       border-radius:3px}}
  .subline{{font-family:'Barlow',sans-serif;font-weight:400;color:#3A342C;
       font-size:{sl}px;line-height:1.4;max-width:{slw}px}}
  .bottom-row{{display:flex;align-items:baseline;justify-content:space-between;
       gap:24px}}
  .kicker{{font-family:'Barlow Condensed',sans-serif;font-weight:700;
       text-transform:uppercase;letter-spacing:.16em;color:#14120F;
       font-size:{kk}px}}
  .footer{{font-family:'Barlow Condensed',sans-serif;font-weight:600;
       letter-spacing:.16em;color:#8F7A36;font-size:{kk}px;white-space:nowrap}}
</style>
<div class="card">
  <div class="frame"></div>

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
    <div class="bottom-row">
      <div class="kicker">{kicker}</div>
      <div class="footer">mygrindapp.com</div>
    </div>
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

    # Compass mark, embedded so the renderer needs no server. Black "MG" + gold
    # ring reads correctly on the cream field; the white/gold-only variants are
    # for dark surfaces.
    mark_b64 = base64.b64encode((REPO / "assets" / "mark.png").read_bytes()).decode()

    for label, (w, h, hl, eb, sl, kk, pad, mk) in SIZES.items():
        # Band edges: clear the top lockup (mark is the taller of mark/eyebrow)
        # and the bottom row, with a breathing gap on each side.
        band_top = pad + max(mk, eb) + int(mk * 0.55)
        band_bottom = pad + kk + int(kk * 1.5)
        html = TEMPLATE.format(
            w=w, h=h, pad=pad, eyebrow=args.eyebrow, headline=args.headline,
            subline=args.subline, kicker=args.kicker, mark=mark_b64, mk=mk,
            hl=hl, eb=eb, sl=sl, kk=kk,
            bandtop=band_top, bandbottom=band_bottom,
            lift=int(h * 0.025),
            rw=int(hl * 0.62), rgap=int(hl * 0.20),
            slw=int((w - 2 * pad) * 0.94),
            inset=int(pad * 0.42), markgap=int(mk * 0.26),
            optical=max(2, int(hl * 0.035)),
        )
        out = outdir / f"{args.prefix}-{label}-{w}x{h}-{args.date}.png"
        render(html, w, h, out)
        print(f"  wrote {out.relative_to(REPO)}")


if __name__ == "__main__":
    main()
