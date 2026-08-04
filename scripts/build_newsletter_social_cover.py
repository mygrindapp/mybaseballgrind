#!/usr/bin/env python3
"""
Build the MyGrind Weekly SOCIAL cover card (Pattern A) that promotes an issue.

  python3 scripts/build_newsletter_social_cover.py \
      --headline "Did they actually rest?" \
      --subline "Three questions before school starts." \
      --outdir media/social/2026-08-04-newsletter --prefix Newsletter-BTS --date 2026-08-04

Matches the established look from
Desktop/MyGrind/Social Media Advertising/2026-06-30 MyGrind QOTD + Newsletter/
MyGrind_Newsletter_textcover_2026-06-30_post.png : near-black field with two
soft rounded panels, centred MyGrind logo, gold letter-spaced MYGRIND WEEKLY
eyebrow, Playfair Display serif headline in cream, short gold divider, grey
subline.

Note the serif: newsletter covers and the QOTD "Today's Grind" cards are the
two places Playfair is used. Everything else in the brand is Bebas + Barlow.

Sizes: 4x5 POST 1080x1350 and 9x16 STORY 1080x1920.
"""
import argparse
import base64
import subprocess
import tempfile
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PROFILE = "/tmp/chrome-nl-social"

# label -> (w, h, logo px, eyebrow px, headline px, subline px, pad px)
SIZES = {
    "4x5-POST":   (1080, 1350, 250, 27, 92, 30, 96),
    "1x1-SQUARE": (1080, 1080, 230, 26, 84, 29, 92),
    "9x16-STORY": (1080, 1920, 270, 29, 100, 32, 104),
}

TEMPLATE = """<!doctype html><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;600&family=Barlow:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  *{{margin:0;padding:0;box-sizing:border-box}}
  html,body{{width:{w}px;height:{h}px;overflow:hidden;background:#0D0D0D}}
  .card{{position:relative;width:{w}px;height:{h}px;background:#0D0D0D;overflow:hidden;
        display:flex;flex-direction:column;align-items:center;justify-content:center;
        padding:0 {pad}px}}
  /* the two soft panels, top-left and bottom-right */
  .panel{{position:absolute;background:#191713}}
  .panel.tl{{top:-{ph}px;left:-{pw}px;width:{pw2}px;height:{ph2}px;border-bottom-right-radius:46px}}
  .panel.br{{bottom:-{ph}px;right:-{pw}px;width:{pw2}px;height:{ph2}px;border-top-left-radius:46px}}
  .inner{{position:relative;z-index:2;width:100%;display:flex;flex-direction:column;align-items:center}}
  .logo{{width:{lg}px;height:auto;display:block;margin-bottom:{lgap}px}}
  .eyebrow{{font-family:'Barlow',sans-serif;font-weight:600;font-size:{eb}px;
        letter-spacing:.44em;text-transform:uppercase;color:#C9A84C;
        text-align:center;margin-bottom:{ebgap}px}}
  .headline{{font-family:'Playfair Display',Georgia,serif;font-weight:500;
        font-size:{hl}px;line-height:1.14;color:#F5F0EB;text-align:center;
        margin-bottom:{hlgap}px}}
  .rule{{width:{rw}px;height:5px;background:#C9A84C;margin-bottom:{hlgap}px}}
  .subline{{font-family:'Barlow',sans-serif;font-weight:400;font-size:{sb}px;
        line-height:1.5;color:#9A9186;text-align:center;max-width:{sw}px}}
</style>
<div class="card">
  <div class="panel tl"></div>
  <div class="panel br"></div>
  <div class="inner">
    <img class="logo" src="data:image/png;base64,{logo}" alt="">
    <div class="eyebrow">MyGrind Weekly</div>
    <div class="headline">{headline}</div>
    <div class="rule"></div>
    <div class="subline">{subline}</div>
  </div>
</div>
"""


def render(html, w, h, out):
    with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False) as fh:
        fh.write(html)
        page = Path(fh.name)
    raw = out.with_suffix(".raw.png")
    raw.unlink(missing_ok=True)
    cmd = [CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
           "--force-device-scale-factor=2", f"--window-size={w},{h}",
           "--no-first-run", "--no-default-browser-check", "--disable-extensions",
           f"--user-data-dir={PROFILE}", f"--screenshot={raw}", f"file://{page}"]
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--headline", required=True)
    ap.add_argument("--subline", required=True)
    ap.add_argument("--outdir", required=True)
    ap.add_argument("--prefix", required=True)
    ap.add_argument("--date", required=True)
    a = ap.parse_args()

    outdir = Path(a.outdir)
    if not outdir.is_absolute():
        outdir = REPO / outdir
    outdir.mkdir(parents=True, exist_ok=True)

    logo_b64 = base64.b64encode((REPO / "assets" / "mygrind-logo-email.png").read_bytes()).decode()

    for label, (w, h, lg, eb, hl, sb, pad) in SIZES.items():
        html = TEMPLATE.format(
            w=w, h=h, pad=pad, logo=logo_b64, lg=lg, eb=eb, hl=hl, sb=sb,
            headline=a.headline, subline=a.subline,
            lgap=int(h * 0.065), ebgap=int(hl * 0.34), hlgap=int(hl * 0.30),
            rw=int(w * 0.12), sw=int(w * 0.74),
            pw=int(w * 0.22), ph=int(h * 0.10),
            pw2=int(w * 0.62), ph2=int(h * 0.27),
        )
        out = outdir / f"{a.prefix}-{label}-{w}x{h}-{a.date}.png"
        render(html, w, h, out)
        print(f"  wrote {out.relative_to(REPO)}")


if __name__ == "__main__":
    main()
