# QOTD social cards

Ready-to-post Quote-of-the-Day cards for MyGrind social (IG/FB Stories, feed,
Pinterest, TikTok). These are generated from the app's own QOTD list, so posting
them showcases the product.

**Rebuilt 2026-06-04** after the original card libraries + build script were lost
in a Mac cleanup (they used to live loose on the Desktop, outside git). Everything
now lives in the repo and is GitHub-backed, so it cannot be lost that way again.

## Layout

```
media/qotd/
  story/   1080x1920  (Stories / Pinterest / TikTok)
    universal/   baseball/   softball/   + INDEX.md each
  feed/    1080x1350  (IG / FB feed portrait)
    universal/   baseball/   softball/   + INDEX.md each
```

`morning-sync` posts one `story/universal/` card per day (rotated by day-of-year).

## Source of truth

The quotes live in **`softball.html`** (the `YBG_QOTD` array). Never hand-edit the
cards or keep a separate quote list — edit the app, then regenerate.

## Regenerate

From the repo root:

```bash
python3 scripts/build_qotd.py                                   # all cards, story + feed
python3 scripts/build_qotd.py --categories universal --formats story   # faster subset
python3 scripts/build_qotd.py --categories baseball softball --limit 2  # samples
```

The builder renders each quote through **`qotd-story.html`** (repo root) with
headless Chrome over `file://`, downscales to exact size with Pillow, and rewrites
the folders above + their `INDEX.md`. No static server needed.
