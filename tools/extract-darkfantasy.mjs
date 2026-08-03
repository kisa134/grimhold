// extract-darkfantasy.mjs — pull ONLY the files the map uses (see
// tools/darkfantasy-manifest.mjs) out of the POLYGON Dark Fantasy source zip
// into public/assets/darkfantasy/ (flat). Reproducible: re-run any time.
//
// Usage (Git Bash, from project root):  node tools/extract-darkfantasy.mjs
// Requires the `unzip` binary on PATH (ships with Git for Windows).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { ALL_FILES, ZIP_PATH, DEST_DIR } from './darkfantasy-manifest.mjs';

if (!existsSync(ZIP_PATH)) {
  console.error('ZIP not found:', ZIP_PATH);
  process.exit(1);
}
mkdirSync(DEST_DIR, { recursive: true });

// unzip -j junks paths so every file lands flat in DEST_DIR.
// Prefix each entry with SourceFiles/ (the zip root folder).
const entries = ALL_FILES.map((f) => 'SourceFiles/' + f);
try {
  execFileSync('unzip', ['-o', '-j', ZIP_PATH, ...entries, '-d', DEST_DIR], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (e) {
  console.error('unzip failed:', e.stderr?.toString() || e.message);
  process.exit(1);
}

// verify every file landed
let missing = 0, total = 0;
for (const f of ALL_FILES) {
  const p = join(DEST_DIR, basename(f));
  if (!existsSync(p)) { console.error('MISSING:', basename(f)); missing++; }
  else total += statSync(p).size;
}
if (missing) { console.error(missing + ' file(s) missing'); process.exit(1); }

const count = readdirSync(DEST_DIR).length;
console.log(`EXTRACT OK: ${count} files, ${(total / 1024 / 1024).toFixed(1)} MB -> ${DEST_DIR}`);
