#!/usr/bin/env python3
"""
Build a JOURNAL-ARTIFACT social card: the card IS a MyGrind journal entry.

  python3 scripts/build_social_journal_card.py \
      --eyebrow  "SATURDAY. GAME DAY." \
      --entry    "Two games. Tee work in the garage after, 40 swings." \
      --next     "Keep the front side closed. Hold my finish for a two-count." \
      --grade    "B" \
      --kicker   "Tonight, one line." \
      --outdir   media/social/2026-07-25-journal-test \
      --prefix   Between-Games-JOURNAL --date 2026-07-25

WHY THIS EXISTS (2026-07-25, Coach's off-signature series)
Coach flagged that near-black + gold + golden-hour photo has become the
generic AI-design signature. This direction sidesteps it by showing the
product instead of describing it: MyGrind IS a journal, so a page from the
journal is the ad. Nobody is generating this shape.

ACCURACY RULE (non-negotiable)
The field labels and grade chips are copied from the real app, not invented:
  "What did I work on today?"                       softball.html
  "What am I taking into the next practice or game?" softball.html
  "How did I perform today?" + A·Excellent B·Good C·Average
   D·Below Avg F·Struggled DNP·Did Not Play          softball.html
The standing rule is that product surfaces in creative must never show an
invented UI. If the app's copy changes, change it here too.

Palette is the app's own light theme (cream field, warm-white card, gold
labels), so this is on-brand rather than a departure. Fonts are the website
system: Barlow Condensed for labels, Barlow for the entry body.

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
PROFILE = "/tmp/chrome-social-journal"

GRADES = [
    ("A", "Excellent"), ("B", "Good"), ("C", "Average"),
    ("D", "Below Avg"), ("F", "Struggled"),
]

# label -> (w, h, label px, entry px, pad px, mark px, chip px)
SIZES = {
    "4x5-FEED":   (1080, 1350, 27, 40, 82, 74, 25),
    "9x16-STORY": (1080, 1920, 29, 44, 88, 80, 27),
    "1x1-SQUARE": (1080, 1080, 25, 37, 76, 66, 23),
    "2x3-PIN":    (1000, 1500, 26, 38, 76, 70, 24),
}

TEMPLATE = """<!doctype html><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow+Condensed:wght@600;700&family=Barlow:wght@400;500&display=swap" rel="stylesheet">
<style>
  *{{margin:0;padding:0;box-sizing:border-box}}
  html,body{{width:{w}px;height:{h}px;overflow:hidden;background:#EFEAE1}}
  .card{{position:relative;width:{w}px;height:{h}px;overflow:hidden;
       background:#EFEAE1;padding:{pad}px;
       display:flex;flex-direction:column}}
  .top{{display:flex;align-items:center;gap:{markgap}px;margin-bottom:{topgap}px}}
  .mark{{width:{mk}px;height:{mk}px;flex:0 0 auto}}
  .eyebrow{{font-family:'Barlow Condensed',sans-serif;font-weight:700;
       text-transform:uppercase;letter-spacing:.26em;color:#8F7A36;
       font-size:{lb}px;line-height:1}}
  /* Sheet is sized to its CONTENT and centred in the space between the top
     lockup and the bottom row. An earlier version gave it flex:1, which
     stretched it to full height and stranded a large void under the grade
     chips. */
  .midwrap{{flex:1;display:flex;align-items:center}}
  /* The journal sheet. Warm white on the cream field, same relationship the
     app's own entry card has to its background. */
  .sheet{{width:100%;background:#FBF9F5;border:1px solid #DED5C6;
       border-radius:10px;padding:{spad}px;
       box-shadow:0 1px 0 rgba(0,0,0,.03)}}
  .datestamp{{font-family:'Barlow Condensed',sans-serif;font-weight:600;
       letter-spacing:.18em;text-transform:uppercase;color:#A2947C;
       font-size:{lb}px;margin-bottom:{blk}px}}
  .field{{margin-bottom:{blk}px}}
  .flabel{{font-family:'Barlow Condensed',sans-serif;font-weight:700;
       text-transform:uppercase;letter-spacing:.13em;color:#8F7A36;
       font-size:{lb}px;margin-bottom:{lgap}px}}
  .ftext{{font-family:'Barlow',sans-serif;font-weight:400;color:#241F19;
       font-size:{en}px;line-height:1.5}}
  .chips{{display:flex;flex-wrap:wrap;gap:{cgap}px;margin-top:{lgap}px}}
  .chip{{font-family:'Barlow Condensed',sans-serif;font-weight:600;
       font-size:{cp}px;letter-spacing:.06em;color:#6E6252;
       border:1px solid #DED5C6;border-radius:999px;
       padding:{cpy}px {cpx}px;white-space:nowrap}}
  .chip.on{{background:#C9A84C;border-color:#C9A84C;color:#201B14;font-weight:700}}
  /* last field carries no bottom margin so the sheet closes tight under it */
  .field:last-of-type{{margin-bottom:0}}
  .kicker{{font-family:'Barlow Condensed',sans-serif;font-weight:700;
       text-transform:uppercase;letter-spacing:.16em;color:#201B14;
       font-size:{lb}px}}
  .bottom{{display:flex;align-items:baseline;justify-content:space-between;
       gap:20px;margin-top:{topgap}px}}
  .footer{{font-family:'Barlow Condensed',sans-serif;font-weight:600;
       letter-spacing:.16em;color:#8F7A36;font-size:{lb}px;white-space:nowrap}}
</style>
<div class="card">
  <div class="top">
    <img class="mark" src="data:image/png;base64,{mark}" alt="">
    <div class="eyebrow">{eyebrow}</div>
  </div>

  <div class="midwrap">
  <div class="sheet">
    <div class="datestamp">{datestamp} &nbsp;·&nbsp; Daily Journal</div>

    <div class="field">
      <div class="flabel">What did I work on today?</div>
      <div class="ftext">{entry}</div>
    </div>

    <div class="field">
      <div class="flabel">What am I taking into the next practice or game?</div>
      <div class="ftext">{nextup}</div>
    </div>

    <div class="field">
      <div class="flabel">How did I perform today?</div>
      <div class="chips">{chips}</div>
    </div>
  </div>
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
    ap.add_argument("--eyebrow", required=True)
    ap.add_argument("--entry", required=True)
    ap.add_argument("--next", dest="nextup", required=True)
    ap.add_argument("--grade", default="B", choices=[g for g, _ in GRADES])
    ap.add_argument("--kicker", default="Tonight, one line.")
    ap.add_argument("--datestamp", default="")
    ap.add_argument("--outdir", required=True)
    ap.add_argument("--prefix", required=True)
    ap.add_argument("--date", required=True)
    args = ap.parse_args()

    outdir = Path(args.outdir)
    if not outdir.is_absolute():
        outdir = REPO / outdir
    outdir.mkdir(parents=True, exist_ok=True)

    mark_b64 = base64.b64encode((REPO / "assets" / "mark.png").read_bytes()).decode()
    datestamp = args.datestamp or args.date

    for label, (w, h, lb, en, pad, mk, cp) in SIZES.items():
        chips = "".join(
            '<div class="chip{on}">{g} &middot; {t}</div>'.format(
                on=" on" if g == args.grade else "", g=g, t=t
            )
            for g, t in GRADES
        )
        html = TEMPLATE.format(
            w=w, h=h, pad=pad, mark=mark_b64, mk=mk,
            eyebrow=args.eyebrow, entry=args.entry, nextup=args.nextup,
            kicker=args.kicker, datestamp=datestamp, chips=chips,
            lb=lb, en=en, cp=cp,
            markgap=int(mk * 0.26), topgap=int(pad * 0.30),
            spad=int(pad * 0.72), blk=int(en * 0.80), lgap=int(lb * 0.55),
            cgap=int(cp * 0.42), cpx=int(cp * 0.62), cpy=int(cp * 0.40),
        )
        out = outdir / f"{args.prefix}-{label}-{w}x{h}-{args.date}.png"
        render(html, w, h, out)
        print(f"  wrote {out.relative_to(REPO)}")


if __name__ == "__main__":
    main()
