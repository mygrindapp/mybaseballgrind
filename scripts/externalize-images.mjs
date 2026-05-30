// One-shot maintenance script: extract inline base64 PNG data URIs from the
// HTML files into content-hashed files under /assets/img/, and rewrite the
// references. SVG data URIs are intentionally left inline (tiny). Idempotent:
// re-running finds nothing once the URIs are externalized.
//
// Usage:  node scripts/externalize-images.mjs [--write]
//         (no flag = dry run report only)

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const FILES = ['softball.html', 'signup.html', 'onboarding.html', 'index.html', 'foundermygrind.html'];
const imgDir = path.join(root, 'assets', 'img');

// Match a PNG data URI value (base64 alphabet only — stops at the closing quote).
const RE = /data:image\/png;base64,[A-Za-z0-9+/=]+/g;

const assets = new Map();   // hash8 -> { bytes, filename }
const perFile = [];

for (const f of FILES) {
  const p = path.join(root, f);
  let html = fs.readFileSync(p, 'utf8');
  const matches = html.match(RE) || [];
  let savedBytes = 0;
  const uniqueInFile = new Set();

  for (const uri of matches) {
    const b64 = uri.slice('data:image/png;base64,'.length);
    const buf = Buffer.from(b64, 'base64');
    const hash8 = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8);
    const filename = `mg-${hash8}.png`;
    if (!assets.has(hash8)) assets.set(hash8, { bytes: buf.length, filename, buf });
    const url = `/assets/img/${filename}`;
    // Replace every occurrence of this exact URI in this file.
    const before = html.length;
    html = html.split(uri).join(url);
    savedBytes += (before - html.length);
    uniqueInFile.add(hash8);
  }

  perFile.push({ file: f, occurrences: matches.length, unique: uniqueInFile.size, savedBytes });

  if (WRITE) fs.writeFileSync(p, html);
}

if (WRITE) {
  fs.mkdirSync(imgDir, { recursive: true });
  for (const { filename, buf } of assets.values()) {
    fs.writeFileSync(path.join(imgDir, filename), buf);
  }
}

console.log(WRITE ? '=== WROTE CHANGES ===' : '=== DRY RUN (no files changed) — pass --write to apply ===');
console.log('\nUnique PNG assets:');
for (const [hash8, a] of assets) console.log(`  /assets/img/${a.filename}  (${(a.bytes/1024).toFixed(1)} KB decoded)`);
console.log('\nPer-file:');
let totalSaved = 0;
for (const r of perFile) {
  console.log(`  ${r.file}: ${r.occurrences} PNG data-URI refs → ${r.unique} unique, ~${(r.savedBytes/1024).toFixed(1)} KB removed from HTML`);
  totalSaved += r.savedBytes;
}
console.log(`\nTotal removed from HTML: ~${(totalSaved/1024).toFixed(1)} KB across ${FILES.length} files`);
console.log(`Unique image files: ${assets.size} (deduped — shared logo written once)`);
