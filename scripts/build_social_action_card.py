#!/usr/bin/env python3
"""
Composite a MyGrind headline over a motion/action photo, at all posting sizes.

  python3 scripts/build_social_action_card.py \
      --bg-tall  "/path/to/9x16-source.png" \
      --bg-wide  "/path/to/4x5-source.png" \
      --eyebrow  "AFTER THE LAST OUT" \
      --headline "More games don't make your player better." \
      --subline  "What they do between games does. Tonight, one line." \
      --outdir   media/social/2026-07-25-between-games \
      --prefix   Between-Games-BASEBALL --date 2026-07-25

Second house layout, added 2026-07-25 because the bottom-scrim Playfair card
(build_social_overlay_card.py) was running every day and the daily posts had
started to look identical. This one is deliberately the opposite shape:

  * TOP-anchored stack over a top-down scrim, so the photo's action and dust
    stay visible in the lower two thirds instead of being buried under text.
  * Bebas Neue condensed caps headline + Barlow subline (the website font
    system, which is the correct one for a marketing/ad surface) instead of
    the Playfair Display italic reserved for QOTD "Today's Grind" cards.
  * A gold hairline rule between headline and subline.

Sizes: 4x5 FEED 1080x1350 / 9x16 STORY 1080x1920 / 1x1 SQUARE 1080x1080 /
2x3 PIN 1000x1500. Tall sizes render from --bg-tall, the rest from --bg-wide.
"""
import argparse
import base64
import subprocess
import tempfile
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PROFILE = "/tmp/chrome-social-action"

# label -> (w, h, source key, headline px, eyebrow px, subline px, footer px, pad px)
SIZES = {
    "4x5-FEED": (1080, 1350, "wide", 104, 30, 38, 28, 84),
    "9x16-STORY": (1080, 1920, "tall", 110, 32, 40, 30, 90),
    "1x1-SQUARE": (1080, 1080, "wide", 96, 28, 35, 26, 80),
    "2x3-PIN": (1000, 1500, "tall", 100, 29, 37, 27, 78),
}

TEMPLATE = """<!doctype html><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow+Condensed:wght@500;600;700&family=Barlow:wght@400;500&display=swap" rel="stylesheet">
<style>
  *{{margin:0;padding:0;box-sizing:border-box}}
  html,body{{width:{w}px;height:{h}px;overflow:hidden;background:#1A1410}}
  .card{{position:relative;width:{w}px;height:{h}px;overflow:hidden}}
  .bg{{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;
       object-position:{focus}}}
  .scrim{{position:absolute;inset:0;background:
       linear-gradient(to bottom, rgba(16,11,8,.93) 0%, rgba(16,11,8,.86) 26%,
                       rgba(16,11,8,.58) 44%, rgba(16,11,8,.14) 62%,
                       rgba(16,11,8,0) 76%);}}
  /* short bottom wash so the gold footer stays legible over backlit dust */
  .botscrim{{position:absolute;left:0;right:0;bottom:0;height:18%;background:
       linear-gradient(to top, rgba(16,11,8,.88) 0%, rgba(16,11,8,.55) 42%,
                       rgba(16,11,8,0) 100%);}}
  .stack{{position:absolute;left:{pad}px;right:{pad}px;top:{pad}px;
       display:flex;flex-direction:column;align-items:flex-start;text-align:left}}
  .eyebrow{{font-family:'Barlow Condensed',sans-serif;font-weight:700;
       text-transform:uppercase;letter-spacing:.30em;color:#D4A574;
       font-size:{eb}px;margin-bottom:{ebgap}px}}
  .headline{{font-family:'Bebas Neue',Impact,sans-serif;font-weight:400;
       text-transform:uppercase;color:#F5EDE0;font-size:{hl}px;line-height:.94;
       letter-spacing:.008em;text-shadow:0 2px 30px rgba(0,0,0,.62)}}
  .rule{{width:{rw}px;height:{rh}px;background:#D4A574;
       margin:{rgap}px 0 {rgap}px 0;border-radius:{rh}px}}
  .subline{{font-family:'Barlow',sans-serif;font-weight:400;color:#F5EDE0;
       font-size:{sl}px;line-height:1.42;max-width:{slw}px;
       text-shadow:0 2px 20px rgba(0,0,0,.55)}}
  .footer{{position:absolute;left:{pad}px;bottom:{pad}px;
       font-family:'Barlow Condensed',sans-serif;font-weight:600;
       letter-spacing:.16em;color:#D4A574;font-size:{ft}px;
       text-shadow:0 2px 18px rgba(0,0,0,.7)}}
</style>
<div class="card">
  <img class="bg" src="data:image/png;base64,{bg}">
  <div class="scrim"></div>
  <div class="botscrim"></div>
  <div class="stack">
    <div class="eyebrow">{eyebrow}</div>
    <div class="headline">{headline}</div>
    <div class="rule"></div>
    <div class="subline">{subline}</div>
  </div>
  <div class="footer">mygrindapp.com</div>
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
    ap.add_argument("--bg-tall", required=True)
    ap.add_argument("--bg-wide", required=True)
    ap.add_argument("--eyebrow", required=True)
    ap.add_argument("--headline", required=True)
    ap.add_argument("--subline", required=True)
    ap.add_argument("--outdir", required=True)
    ap.add_argument("--prefix", required=True)
    ap.add_argument("--date", required=True)
    ap.add_argument("--focus", default="center 58%")
    args = ap.parse_args()

    b64 = {
        "tall": base64.b64encode(Path(args.bg_tall).read_bytes()).decode(),
        "wide": base64.b64encode(Path(args.bg_wide).read_bytes()).decode(),
    }
    outdir = Path(args.outdir)
    if not outdir.is_absolute():
        outdir = REPO / outdir
    outdir.mkdir(parents=True, exist_ok=True)

    for label, (w, h, key, hl, eb, sl, ft, pad) in SIZES.items():
        html = TEMPLATE.format(
            w=w, h=h, bg=b64[key], focus=args.focus, pad=pad,
            eyebrow=args.eyebrow, headline=args.headline, subline=args.subline,
            hl=hl, eb=eb, sl=sl, ft=ft,
            ebgap=int(eb * 0.7), rw=int(hl * 0.9), rh=max(3, int(hl * 0.035)),
            rgap=int(hl * 0.24), slw=int((w - 2 * pad) * 0.92),
        )
        out = outdir / f"{args.prefix}-{label}-{w}x{h}-{args.date}.png"
        render(html, w, h, out)
        print(f"  wrote {out.relative_to(REPO)}")


if __name__ == "__main__":
    main()
