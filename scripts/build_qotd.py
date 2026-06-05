#!/usr/bin/env python3
"""
build_qotd.py — regenerate MyGrind Quote-of-the-Day social cards.

Rebuilt 2026-06-04 after the original build script + card libraries were lost in
a Mac cleanup (they lived loose on the Desktop, OUTSIDE git). This now lives in
the repo so it is GitHub-backed and cannot be lost again. Source of truth for the
quotes is the YBG_QOTD array in softball.html — never hand-maintain a copy here.

Pipeline:
  1. Parse YBG_QOTD straight from softball.html.
  2. Render each quote through qotd-story.html with headless Chrome (dsf=2),
     loading over file:// so query strings + relative assets just work.
  3. Downscale the 2x screenshot to the exact target size with Pillow.
  4. Sort cards into universal/ baseball/ softball/ and write an INDEX.md.

Outputs to media/qotd/<format>/<category>/. morning-sync posts the
media/qotd/story/universal/ set daily.

Usage:
  python3 scripts/build_qotd.py                          # everything, story + feed
  python3 scripts/build_qotd.py --formats story          # story only
  python3 scripts/build_qotd.py --categories universal    # one category
  python3 scripts/build_qotd.py --categories baseball softball --limit 2  # samples
  python3 scripts/build_qotd.py --categories universal --limit 1 --formats story  # smoke test
"""
import re
import sys
import time
import argparse
import subprocess
import urllib.parse
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
RENDERER = REPO / "qotd-story.html"
SOURCE = REPO / "softball.html"
OUTROOT = REPO / "media" / "qotd"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PROFILE = "/tmp/chrome-qotd-profile"  # separate profile so it never touches Coach's Chrome

SIZES = {"story": (1080, 1920), "feed": (1080, 1350)}
CATEGORIES = ("universal", "baseball", "softball")


def parse_quotes(src_path: Path):
    """Extract {q, a, sport} objects from the YBG_QOTD array in softball.html."""
    text = src_path.read_text(encoding="utf-8")
    m = re.search(r"var\s+YBG_QOTD\s*=\s*\[(.*?)\]\s*;", text, re.S)
    if not m:
        sys.exit("ERROR: could not find the YBG_QOTD array in softball.html")
    body = m.group(1)
    quotes = []
    for obj in re.finditer(r"\{[^{}]*\}", body):
        chunk = obj.group(0)
        qy = re.search(r"\bq:\s*\"((?:[^\"\\]|\\.)*)\"", chunk)
        if not qy:
            continue
        ay = re.search(r"\ba:\s*\"((?:[^\"\\]|\\.)*)\"", chunk)
        sy = re.search(r"\bsport:\s*\"([^\"]*)\"", chunk)

        def unescape(s):
            # only JS string escapes that actually occur; keep UTF-8 (·, ', etc.) intact
            return s.replace('\\"', '"').replace("\\\\", "\\")

        quotes.append({
            "q": unescape(qy.group(1)),
            "a": unescape(ay.group(1)) if ay else "The Grind",
            "sport": (sy.group(1).lower() if sy else "universal"),
        })
    return quotes


def slugify(text: str, n: int = 6) -> str:
    words = re.findall(r"[A-Za-z0-9]+", text.lower())
    return ("-".join(words[:n])[:48]) or "quote"


def render(quote: dict, out_path: Path, fmt: str):
    w, h = SIZES[fmt]
    base = "file://" + urllib.parse.quote(str(RENDERER))
    url = f"{base}?q={urllib.parse.quote(quote['q'])}&a={urllib.parse.quote(quote['a'])}&format={fmt}"
    if quote["sport"] in ("baseball", "softball"):
        url += f"&sport={quote['sport']}"

    raw = out_path.with_suffix(".raw.png")
    if raw.exists():
        raw.unlink()
    # Chrome headless --screenshot writes the PNG but frequently does NOT exit on
    # its own (true for both --headless=new and =old here). So launch detached,
    # wait for the screenshot to finish writing, then terminate it.
    for lock in ("SingletonLock", "SingletonCookie", "SingletonSocket"):
        try:
            (Path(PROFILE) / lock).unlink()
        except OSError:
            pass
    cmd = [
        CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
        "--force-device-scale-factor=2", f"--window-size={w},{h}",
        "--no-first-run", "--no-default-browser-check", "--disable-extensions",
        f"--user-data-dir={PROFILE}", f"--screenshot={raw}", url,
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        deadline = time.time() + 45
        last_size, stable_at = -1, None
        while time.time() < deadline:
            if proc.poll() is not None:            # Chrome exited by itself
                break
            if raw.exists():
                sz = raw.stat().st_size
                if sz > 0 and sz == last_size:
                    if stable_at and (time.time() - stable_at) >= 0.8:
                        break                      # screenshot fully written
                else:
                    last_size, stable_at = sz, time.time()
            time.sleep(0.2)
    finally:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=8)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=4)

    if not raw.exists() or raw.stat().st_size == 0:
        raise RuntimeError(f"screenshot not produced: {out_path.name}")

    from PIL import Image
    img = Image.open(raw).convert("RGB")
    if img.size != (w, h):
        img = img.resize((w, h), Image.LANCZOS)
    img.save(out_path, "PNG", optimize=True)
    raw.unlink(missing_ok=True)


def write_index(folder: Path, fmt: str, cat: str, items: list):
    w, h = SIZES[fmt]
    lines = [
        f"# QOTD — {cat} ({fmt} {w}x{h})",
        "",
        f"{len(items)} card(s). Auto-generated by `scripts/build_qotd.py` from the "
        "YBG_QOTD array in `softball.html`. Do not edit by hand — re-run the builder.",
        "",
        "| File | Quote |",
        "| --- | --- |",
    ]
    for fname, q in items:
        lines.append(f"| `{fname}` | {q['q']} |")
    (folder / "INDEX.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main():
    ap = argparse.ArgumentParser(description="Regenerate MyGrind QOTD social cards.")
    ap.add_argument("--formats", nargs="+", default=["story", "feed"], choices=SIZES.keys())
    ap.add_argument("--categories", nargs="+", default=list(CATEGORIES), choices=CATEGORIES)
    ap.add_argument("--limit", type=int, default=0, help="max cards per category (0 = all)")
    args = ap.parse_args()

    if not RENDERER.exists():
        sys.exit(f"ERROR: renderer missing: {RENDERER}")
    if not Path(CHROME).exists():
        sys.exit(f"ERROR: Chrome missing: {CHROME}")

    quotes = parse_quotes(SOURCE)
    by_cat = {c: [q for q in quotes if q["sport"] == c] for c in CATEGORIES}
    print(f"Parsed {len(quotes)} quotes  "
          f"(universal={len(by_cat['universal'])}, baseball={len(by_cat['baseball'])}, "
          f"softball={len(by_cat['softball'])})")

    total = 0
    failures = []
    for fmt in args.formats:
        for cat in args.categories:
            group = by_cat[cat]
            if args.limit:
                group = group[:args.limit]
            if not group:
                continue
            folder = OUTROOT / fmt / cat
            folder.mkdir(parents=True, exist_ok=True)
            for old in folder.glob("*.png"):  # clear so renames don't orphan
                old.unlink()
            items = []
            for i, q in enumerate(group):
                fname = f"{i:02d}-{slugify(q['q'])}.png"
                print(f"  [{fmt}/{cat}] {fname}")
                try:
                    render(q, folder / fname, fmt)
                    items.append((fname, q))
                    total += 1
                except Exception as e:  # one bad render must not abort the batch
                    failures.append(f"{fmt}/{cat}/{fname}: {e}")
                    print(f"    !! FAILED: {e}")
            write_index(folder, fmt, cat, items)

    print(f"DONE — {total} card(s) written under {OUTROOT}")
    if failures:
        print(f"{len(failures)} FAILED:")
        for f in failures:
            print("  " + f)
        sys.exit(1)


if __name__ == "__main__":
    main()
