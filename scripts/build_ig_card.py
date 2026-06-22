#!/usr/bin/env python3
"""
Render one MyGrind Instagram card (1080x1350) from og-cover-ig.html.

  python3 scripts/build_ig_card.py "<eyebrow>" "<title>" "<output.png>"

Serves the repo over a throwaway local server (so /assets resolves), renders
with headless Chrome at 2x, downscales to exactly 1080x1350 with Pillow.
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
TEMPLATE = REPO / "og-cover-ig.html"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PROFILE = "/tmp/chrome-ig-card"
W, H = 1080, 1350


def render(base_url, eyebrow, title, out_path):
    url = (f"{base_url}/og-cover-ig.html?eyebrow="
           + urllib.parse.quote(eyebrow) + "&title=" + urllib.parse.quote(title))
    raw = out_path.with_suffix(".raw.png")
    if raw.exists():
        raw.unlink()
    cmd = [
        CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
        "--force-device-scale-factor=2", f"--window-size={W},{H}",
        "--no-first-run", "--no-default-browser-check", "--disable-extensions",
        f"--user-data-dir={PROFILE}", f"--screenshot={raw}", url,
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
        raise RuntimeError("screenshot not produced")
    from PIL import Image
    img = Image.open(raw).convert("RGB")
    if img.size != (W, H):
        img = img.resize((W, H), Image.LANCZOS)
    img.save(out_path, "PNG", optimize=True)
    raw.unlink(missing_ok=True)


def main():
    if len(sys.argv) != 4:
        sys.exit('usage: build_ig_card.py "<eyebrow>" "<title>" "<output.png>"')
    eyebrow, title, out = sys.argv[1], sys.argv[2], Path(sys.argv[3]).expanduser()
    out.parent.mkdir(parents=True, exist_ok=True)
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(REPO))
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    time.sleep(0.4)
    try:
        render(f"http://127.0.0.1:{port}", eyebrow, title, out)
        print(f"ok  {out}  ({out.stat().st_size // 1024} KB)")
    finally:
        httpd.shutdown()


if __name__ == "__main__":
    main()
