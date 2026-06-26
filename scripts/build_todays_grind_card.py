#!/usr/bin/env python3
"""
Build a "Today's Grind" QOTD social card (Coach's editorial serif style) and
render it at posting sizes: Story 1080x1920, Feed 1080x1350, Square 1080x1080.

Style (locked 2026-06-26): the gold compass mark on a near-black warm-glow
background, "TODAY'S GRIND" eyebrow + "MYGRIND" footer in Barlow Condensed
(gold, uppercase, letter-spaced), and the quote in Playfair Display italic
(cream). The logo is embedded as base64, so the headless render needs no
server. This is the QOTD card style Coach posts to social; the plainer
Barlow-Condensed cards in media/qotd/ are a separate (older) system.

Usage:
  python3 scripts/build_todays_grind_card.py --quote "Mental reps count. Visualize before every at-bat, every pitch, every play." --slug mental-reps
  python3 scripts/build_todays_grind_card.py            # uses the default sample quote

Output: media/qotd/todays-grind/<slug>/ (STORY / FEED / SQUARE PNGs)
Requires: Google Chrome + Pillow. Re-run any time; add the quote you want.
"""
import argparse, base64, subprocess, tempfile, os, re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
LOGO = REPO / "assets" / "mark-on-dark.png"
OUT_ROOT = REPO / "media" / "qotd" / "todays-grind"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

SIZES = [
    (1080, 1920, "STORY"),   # IG/FB Story, TikTok, Pinterest idea pin
    (1080, 1350, "FEED"),    # IG/FB feed (portrait)
    (1080, 1080, "SQUARE"),  # universal square
]

DEFAULT_QUOTE = "Mental reps count. Visualize before every at-bat, every pitch, every play."


def slugify(text):
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return "-".join(s.split("-")[:6]) or "qotd"


def html(w, h, quote, logo_b64):
    return f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@1,500;1,600&family=Barlow+Condensed:wght@600;700&display=swap" rel="stylesheet">
<style>
  *{{margin:0;padding:0;box-sizing:border-box;}}
  html,body{{width:{w}px;height:{h}px;}}
  body{{
    background:#0a0a0a;
    background-image:radial-gradient(120% 70% at 50% 30%, #1c1813 0%, #0d0b09 45%, #060504 100%);
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    text-align:center;padding:0 110px;
  }}
  .logo{{width:200px;height:auto;display:block;margin-bottom:46px;
    filter:drop-shadow(0 0 30px rgba(201,168,76,0.18));}}
  .eyebrow{{font-family:'Barlow Condensed',sans-serif;font-weight:700;
    text-transform:uppercase;letter-spacing:9px;color:#C9A84C;
    font-size:30px;margin-bottom:54px;}}
  .quote{{font-family:'Playfair Display',Georgia,serif;font-style:italic;font-weight:500;
    color:#F2ECE3;font-size:62px;line-height:1.32;max-width:880px;}}
  .rule{{width:54px;height:2px;background:#C9A84C;opacity:.85;margin:64px 0 26px;}}
  .footer{{font-family:'Barlow Condensed',sans-serif;font-weight:600;
    text-transform:uppercase;letter-spacing:10px;color:#C9A84C;font-size:30px;}}
</style></head>
<body>
  <img class="logo" src="data:image/png;base64,{logo_b64}">
  <div class="eyebrow">Today's Grind</div>
  <div class="quote">&ldquo;{quote}&rdquo;</div>
  <div class="rule"></div>
  <div class="footer">MyGrind</div>
</body></html>"""


def render(w, h, label, quote, logo_b64, out_dir, slug):
    with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False) as f:
        f.write(html(w, h, quote, logo_b64))
        path = f.name
    out = out_dir / f"todays-grind-{slug}-{label}-{w}x{h}.png"
    subprocess.run([
        CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
        "--force-device-scale-factor=2", f"--window-size={w},{h}",
        "--virtual-time-budget=3500", f"--screenshot={out}", f"file://{path}",
    ], check=True, capture_output=True)
    try:
        from PIL import Image
        Image.open(out).convert("RGB").resize((w, h), Image.LANCZOS).save(out, "PNG")
    except Exception as e:
        print("  (pillow downscale skipped:", e, ")")
    os.unlink(path)
    print(f"  ok  {out.relative_to(REPO)}  {w}x{h}")


def main():
    ap = argparse.ArgumentParser(description="Build a Today's Grind QOTD card at posting sizes.")
    ap.add_argument("--quote", default=DEFAULT_QUOTE, help="The quote text (no surrounding quotes needed).")
    ap.add_argument("--slug", default=None, help="Output folder/name slug (default: derived from the quote).")
    args = ap.parse_args()

    slug = args.slug or slugify(args.quote)
    logo_b64 = base64.b64encode(LOGO.read_bytes()).decode()
    out_dir = OUT_ROOT / slug
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f'Building "Today\'s Grind" card for: "{args.quote}"  -> media/qotd/todays-grind/{slug}/')
    for w, h, label in SIZES:
        render(w, h, label, args.quote, logo_b64, out_dir, slug)
    print("done")


if __name__ == "__main__":
    main()
