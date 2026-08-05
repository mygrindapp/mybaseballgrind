#!/usr/bin/env python3
"""
Build a REAL-APP-SCREEN MyGrind social card: headline on cream, and a genuine
screenshot of the shipping app rising from the bottom edge.

  python3 scripts/build_social_appscreen_card.py \
      --eyebrow  "AUGUST · BACK TO SCHOOL" \
      --headline "PRACTICE. GAMES. GRADES.<br>ONE JOURNAL." \
      --subline  "Your player logs the work and the grades that keep them eligible." \
      --kicker   "Tonight, one line." \
      --shot     /path/to/real-app-screenshot.png \
      --outdir   media/social/2026-08-05-one-journal-real-screen \
      --prefix   One-Journal-SOFTBALL --date 2026-08-05

WHY THIS EXISTS (2026-08-05, Coach's call)
Instagram comments called the generated cards out as AI. Coach's answer: show
the actual product. The screenshot is captured from the real app via
scripts/shoot-light-dashboard.html (seeded demo data, headless Chrome at
540x720 @2x), so nothing on the card is invented and no generative model
touches any pixel. This is builder #3 alongside build_social_light_card.py
and build_social_journal_card.py.

ACCURACY RULE (non-negotiable, same as the journal card)
The screen shown must be a genuine capture of the shipping UI. Never a mockup,
never a generated approximation, never a re-typed recreation.

Layout: the light card's cream field and type system (Bebas Neue headline,
Barlow Condensed labels, Barlow body), with the phone screen anchored to the
bottom edge and bleeding off it, framed by a soft device edge and shadow.

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
PROFILE = "/tmp/chrome-social-appscreen"

# label -> (w, h, headline px, eyebrow px, subline px, kicker px, pad,
#           mark px, screen width px, screen top px)
# The screen top leaves the text zone clear; the screenshot (3:4) always
# overflows the bottom edge, which is the point — the app keeps going.
SIZES = {
    "4x5-FEED":   (1080, 1350, 104, 30, 40, 30,  84, 80, 660, 660),
    "9x16-STORY": (1080, 1920, 128, 33, 46, 33,  96, 92, 780, 830),
    "1x1-SQUARE": (1080, 1080,  88, 28, 36, 28,  76, 72, 560, 600),
    "2x3-PIN":    (1000, 1500, 106, 29, 40, 29,  80, 78, 640, 720),
}

TEMPLATE = """<!doctype html><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow+Condensed:wght@600;700&family=Barlow:wght@400;500&display=swap" rel="stylesheet">
<style>
  *{{margin:0;padding:0;box-sizing:border-box}}
  html,body{{width:{w}px;height:{h}px;overflow:hidden;background:#F7F4EF}}
  .card{{position:relative;width:{w}px;height:{h}px;overflow:hidden;
       background:#F7F4EF}}
  .top{{position:absolute;left:{pad}px;right:{pad}px;top:{pad}px;
       display:flex;align-items:center;gap:{markgap}px}}
  .mark{{width:{mk}px;height:{mk}px;flex:0 0 auto}}
  .eyebrow{{font-family:'Barlow Condensed',sans-serif;font-weight:700;
       text-transform:uppercase;letter-spacing:.30em;color:#8F7A36;
       font-size:{eb}px;line-height:1}}
  .footer{{font-family:'Barlow Condensed',sans-serif;font-weight:600;
       letter-spacing:.16em;color:#8F7A36;font-size:{eb}px;margin-left:auto;
       white-space:nowrap}}
  .head{{position:absolute;left:{pad}px;right:{pad}px;top:{headtop}px}}
  .headline{{font-family:'Bebas Neue',Impact,sans-serif;text-transform:uppercase;
       color:#14120F;font-size:{hl}px;line-height:.92;letter-spacing:.004em;
       margin-left:-{optical}px}}
  .rule{{width:{rw}px;height:3px;background:#C9A84C;margin:{rgap}px 0;
       border-radius:3px}}
  .subline{{font-family:'Barlow',sans-serif;font-weight:400;color:#3A342C;
       font-size:{sl}px;line-height:1.38;max-width:{slw}px}}
  /* No kicker row on this builder: the screen owns the lower half, and a
     kicker collided with it on the 4x5. The caption carries the CTA. */
  /* The real app screen: genuine capture, soft device edge, off the bottom. */
  .shot{{position:absolute;left:50%;transform:translateX(-50%);
       top:{shottop}px;width:{shotw}px;
       border-radius:44px 44px 0 0;overflow:hidden;
       border:3px solid rgba(20,18,15,.16);border-bottom:0;
       box-shadow:0 -6px 60px rgba(20,18,15,.16)}}
  .shot img{{display:block;width:100%}}
</style>
<div class="card">
  <div class="head">
    <div class="headline">{headline}</div>
    <div class="rule"></div>
    <div class="subline">{subline}</div>
  </div>
  <div class="shot"><img src="data:image/png;base64,{shot}" alt=""></div>
  <div class="top">
    <img class="mark" src="data:image/png;base64,{mark}" alt="">
    <div class="eyebrow">{eyebrow}</div>
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
    ap.add_argument("--eyebrow", required=True)
    ap.add_argument("--headline", required=True)
    ap.add_argument("--subline", required=True)
    ap.add_argument("--kicker", default="Tonight, one line.")
    ap.add_argument("--shot", required=True, help="path to the real app screenshot PNG")
    ap.add_argument("--outdir", required=True)
    ap.add_argument("--prefix", required=True)
    ap.add_argument("--date", required=True)
    args = ap.parse_args()

    outdir = Path(args.outdir)
    if not outdir.is_absolute():
        outdir = REPO / outdir
    outdir.mkdir(parents=True, exist_ok=True)

    mark_b64 = base64.b64encode((REPO / "assets" / "mark.png").read_bytes()).decode()
    shot_b64 = base64.b64encode(Path(args.shot).read_bytes()).decode()

    for label, (w, h, hl, eb, sl, kk, pad, mk, shotw, shottop) in SIZES.items():
        html = TEMPLATE.format(
            w=w, h=h, pad=pad, eyebrow=args.eyebrow, headline=args.headline,
            subline=args.subline, mark=mark_b64,
            shot=shot_b64, mk=mk, hl=hl, eb=eb, sl=sl, kk=kk,
            shotw=shotw, shottop=shottop,
            headtop=pad + mk + int(mk * 0.7),
            rw=int(hl * 0.62), rgap=int(hl * 0.20),
            slw=int((w - 2 * pad) * 0.94),
            markgap=int(mk * 0.26),
            optical=max(2, int(hl * 0.035)),
        )
        out = outdir / f"{args.prefix}-{label}-{w}x{h}-{args.date}.png"
        render(html, w, h, out)
        print(f"  wrote {out.relative_to(REPO)}")


if __name__ == "__main__":
    main()
