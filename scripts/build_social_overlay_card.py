#!/usr/bin/env python3
"""
Composite a MyGrind social headline over an existing photo, at all posting sizes.

  python3 scripts/build_social_overlay_card.py \
      --bg-tall  "/path/to/9x16-source.png" \
      --bg-wide  "/path/to/4x5-source.png" \
      --eyebrow  "TONIGHT'S REP" \
      --headline "Ten swings off the tee. One line about what you fixed." \
      --outdir   media/social/2026-07-23-tee-reps \
      --prefix   Tee-Reps-BASEBALL --date 2026-07-23

House style (locked): Barlow Condensed gold caps eyebrow, Playfair Display
italic cream headline, "mygrindapp.com" footer, bottom scrim over the photo.
Same look as the 2026-07-22 card pair. Backgrounds are reused library stills,
so no generation is needed for a re-caption.

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
PROFILE = "/tmp/chrome-social-overlay"

# label -> (w, h, source key, headline px, eyebrow px, footer px, side pad px)
SIZES = {
    "4x5-FEED": (1080, 1350, "wide", 68, 30, 28, 84),
    "9x16-STORY": (1080, 1920, "tall", 72, 32, 30, 90),
    "1x1-SQUARE": (1080, 1080, "wide", 62, 28, 26, 80),
    "2x3-PIN": (1000, 1500, "tall", 66, 29, 27, 78),
}

TEMPLATE = """<!doctype html><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@1,500;1,600&family=Barlow+Condensed:wght@600;700&display=swap" rel="stylesheet">
<style>
  *{{margin:0;padding:0;box-sizing:border-box}}
  html,body{{width:{w}px;height:{h}px;overflow:hidden;background:#1A1410}}
  .card{{position:relative;width:{w}px;height:{h}px;overflow:hidden}}
  .bg{{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;
       object-position:{focus}}}
  .scrim{{position:absolute;inset:0;background:
       linear-gradient(to top, rgba(16,11,8,.94) 0%, rgba(16,11,8,.88) 22%,
                       rgba(16,11,8,.55) 40%, rgba(16,11,8,.10) 60%,
                       rgba(16,11,8,0) 75%);}}
  .stack{{position:absolute;left:{pad}px;right:{pad}px;bottom:{pad}px;
       display:flex;flex-direction:column;align-items:center;text-align:center}}
  .eyebrow{{font-family:'Barlow Condensed',sans-serif;font-weight:700;
       text-transform:uppercase;letter-spacing:.30em;color:#D4A574;
       font-size:{eb}px;margin-bottom:{ebgap}px}}
  .headline{{font-family:'Playfair Display',Georgia,serif;font-style:italic;
       font-weight:500;color:#F5EDE0;font-size:{hl}px;line-height:1.28;
       text-shadow:0 2px 26px rgba(0,0,0,.55)}}
  .footer{{font-family:'Barlow Condensed',sans-serif;font-weight:600;
       letter-spacing:.16em;color:#D4A574;font-size:{ft}px;margin-top:{ftgap}px}}
</style>
<div class="card">
  <img class="bg" src="data:image/png;base64,{bg}">
  <div class="scrim"></div>
  <div class="stack">
    <div class="eyebrow">{eyebrow}</div>
    <div class="headline">{headline}</div>
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
    ap.add_argument("--bg-tall", required=True)
    ap.add_argument("--bg-wide", required=True)
    ap.add_argument("--eyebrow", required=True)
    ap.add_argument("--headline", required=True)
    ap.add_argument("--outdir", required=True)
    ap.add_argument("--prefix", required=True)
    ap.add_argument("--date", required=True)
    ap.add_argument("--focus", default="center 38%")
    args = ap.parse_args()

    b64 = {
        "tall": base64.b64encode(Path(args.bg_tall).read_bytes()).decode(),
        "wide": base64.b64encode(Path(args.bg_wide).read_bytes()).decode(),
    }
    outdir = Path(args.outdir)
    if not outdir.is_absolute():
        outdir = REPO / outdir
    outdir.mkdir(parents=True, exist_ok=True)

    for label, (w, h, key, hl, eb, ft, pad) in SIZES.items():
        html = TEMPLATE.format(
            w=w, h=h, bg=b64[key], focus=args.focus, pad=pad,
            eyebrow=args.eyebrow, headline=args.headline,
            hl=hl, eb=eb, ft=ft, ebgap=int(eb * 0.9), ftgap=int(ft * 1.5),
        )
        out = outdir / f"{args.prefix}-{label}-{w}x{h}-{args.date}.png"
        render(html, w, h, out)
        print(f"  wrote {out.relative_to(REPO)}")


if __name__ == "__main__":
    main()
