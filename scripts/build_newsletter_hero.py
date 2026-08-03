#!/usr/bin/env python3
"""
Build the MyGrind Weekly hero card (1200x600) that opens every issue.

  python3 scripts/build_newsletter_hero.py \
      --eyebrow "MyGrind Weekly · The Tryout Issue" \
      --headline "The one rep that decides it." \
      --subline "What actually gets measured, what your job is, and what to do if they do not make it." \
      --out assets/newsletter/2026-08-04-tryouts-hero.png

Standing element since 2026-07-21 (see the newsletter-hero-image-rule memory).
Style matched pixel-for-pixel to 2026-07-28-girls-baseball-hero.png:
warm near-black #17120E, gold #C9A84C hairlines top and bottom, gold
letter-spaced eyebrow, Bebas Neue cream headline, Barlow subline.

Renders through headless Chrome so the webfonts match the rest of the brand,
then downscales the 2x shot to exactly 1200x600 with Pillow.
"""
import argparse
import subprocess
import tempfile
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PROFILE = "/tmp/chrome-newsletter-hero"
W, H = 1200, 600

TEMPLATE = """<!doctype html><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow:wght@400;500&display=swap" rel="stylesheet">
<style>
  *{{margin:0;padding:0;box-sizing:border-box}}
  html,body{{width:{w}px;height:{h}px;overflow:hidden;background:#17120E}}
  .card{{position:relative;width:{w}px;height:{h}px;background:#17120E;
        display:flex;flex-direction:column;align-items:center;justify-content:center;
        padding:0 90px}}
  .rule{{position:absolute;left:78px;right:78px;height:2px;background:#C9A84C}}
  .rule.top{{top:88px}}
  .rule.bot{{bottom:88px}}
  .eyebrow{{font-family:'Barlow',sans-serif;font-weight:500;font-size:22px;
        letter-spacing:.42em;text-transform:uppercase;color:#C9A84C;
        text-align:center;margin-bottom:14px}}
  .headline{{font-family:'Bebas Neue',sans-serif;font-size:{hs}px;line-height:.95;
        color:#F5F0EB;text-align:center;letter-spacing:.5px;margin-bottom:26px}}
  .subline{{font-family:'Barlow',sans-serif;font-weight:400;font-size:26px;
        line-height:1.45;color:#E6DCD2;text-align:center;max-width:840px}}
</style>
<div class="card">
  <div class="rule top"></div>
  <div class="eyebrow">{eyebrow}</div>
  <div class="headline">{headline}</div>
  <div class="subline">{subline}</div>
  <div class="rule bot"></div>
</div>
"""


def render(html: str, out: Path) -> None:
    with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False) as fh:
        fh.write(html)
        page = Path(fh.name)
    raw = out.with_suffix(".raw.png")
    raw.unlink(missing_ok=True)
    cmd = [
        CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
        "--force-device-scale-factor=2", f"--window-size={W},{H}",
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
        raise RuntimeError("screenshot not produced")
    from PIL import Image
    img = Image.open(raw).convert("RGB")
    if img.size != (W, H):
        img = img.resize((W, H), Image.LANCZOS)
    img.save(out, "PNG", optimize=True)
    raw.unlink(missing_ok=True)
    page.unlink(missing_ok=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--eyebrow", required=True)
    ap.add_argument("--headline", required=True)
    ap.add_argument("--subline", required=True)
    ap.add_argument("--headline-size", type=int, default=104)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    out = Path(a.out)
    if not out.is_absolute():
        out = REPO / out
    out.parent.mkdir(parents=True, exist_ok=True)

    html = TEMPLATE.format(w=W, h=H, hs=a.headline_size,
                           eyebrow=a.eyebrow, headline=a.headline, subline=a.subline)
    render(html, out)
    print(f"  wrote {out.relative_to(REPO)}")


if __name__ == "__main__":
    main()
