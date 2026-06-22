#!/usr/bin/env python3
"""
Build MyGrind social share cards (og:image) from the og-cover.html template.

  1. Spins up a throwaway local HTTP server rooted at the repo, so the template's
     /assets/ logo + fonts resolve (a file:// render would 404 the absolute paths).
  2. Renders each card through og-cover.html?eyebrow=&title= with headless Chrome
     at 1200x630, device-scale-factor 2 for crispness.
  3. Downscales the 2x screenshot to exactly 1200x630 with Pillow.
  4. Writes to /assets/og/<slug>.png.

Re-run any time to regenerate. Add a card by appending to CARDS below.
Keep it consistent: only the eyebrow + title change, everything else is the template.

  python3 scripts/build_og.py
"""
import functools
import http.server
import socketserver
import subprocess
import sys
import threading
import time
import urllib.parse
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
TEMPLATE = REPO / "og-cover.html"
OUT_DIR = REPO / "assets" / "og"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PROFILE = "/tmp/chrome-og-profile"
W, H = 1200, 630

# slug -> the only two fields that ever change. Everything else is the template.
CARDS = [
    {"slug": "default",
     "eyebrow": "MyGrind",
     "title": "Baseball & Softball Training Journal"},
    {"slug": "picks",
     "eyebrow": "Coach's Picks",
     "title": "Best Baseball & Softball Books & Gear"},
    {"slug": "ncaa-eligibility-gpa-guide",
     "eyebrow": "The Playbook · Recruiting",
     "title": "Your kid's 3.7 might be a 2.9 to the NCAA"},
    {"slug": "choosing-high-school-baseball-softball",
     "eyebrow": "The Playbook · High School",
     "title": "Private vs public: the playing-time math"},
]


def render(base_url: str, card: dict, out_path: Path):
    url = (f"{base_url}/og-cover.html?eyebrow="
           + urllib.parse.quote(card["eyebrow"])
           + "&title=" + urllib.parse.quote(card["title"]))
    raw = out_path.with_suffix(".raw.png")
    if raw.exists():
        raw.unlink()
    # Unique profile per card so a lingering prior Chrome can't make the next
    # launch hand off to the existing instance and skip the screenshot.
    profile = f"{PROFILE}-{out_path.stem}"
    cmd = [
        CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
        "--force-device-scale-factor=2", f"--window-size={W},{H}",
        "--no-first-run", "--no-default-browser-check", "--disable-extensions",
        f"--user-data-dir={profile}", f"--screenshot={raw}", url,
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        deadline = time.time() + 45
        last_size, stable_at = -1, None
        while time.time() < deadline:
            if proc.poll() is not None:
                break
            if raw.exists():
                sz = raw.stat().st_size
                if sz > 0 and sz == last_size:
                    if stable_at and (time.time() - stable_at) >= 0.8:
                        break
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
    if img.size != (W, H):
        img = img.resize((W, H), Image.LANCZOS)
    img.save(out_path, "PNG", optimize=True)
    raw.unlink(missing_ok=True)


def main():
    if not TEMPLATE.exists():
        sys.exit(f"ERROR: template missing: {TEMPLATE}")
    if not Path(CHROME).exists():
        sys.exit(f"ERROR: Chrome missing: {CHROME}")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # throwaway local server so /assets/ resolves during render
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(REPO))
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base_url = f"http://127.0.0.1:{port}"
    time.sleep(0.4)

    try:
        for card in CARDS:
            out = OUT_DIR / f"{card['slug']}.png"
            render(base_url, card, out)
            kb = out.stat().st_size // 1024
            print(f"  ok  assets/og/{card['slug']}.png  ({kb} KB)")
    finally:
        httpd.shutdown()

    print(f"Done. {len(CARDS)} cards -> assets/og/")


if __name__ == "__main__":
    main()
