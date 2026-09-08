/**
 * Regression test for the zip-cleanup step in scripts/package-extension.sh.
 *
 * The cleanup loop removes previously packaged ZIPs (simple-tab-summarizer-v*.zip)
 * before creating the new one. This test guards the invariant that the cleanup is
 * SCOPED to that naming pattern and never disturbs unrelated files or directories
 * that happen to live in dist/.
 *
 * It runs the REAL packaging script (no logic duplication) with DIST_DIR pointed
 * at a throwaway temp directory, so the repo's own dist/ is never touched.
 *
 * Run with: node tests/unit/test-package-cleanup.mjs
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT_DIR, 'scripts', 'package-extension.sh');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.error(`  ❌ ${message}`);
  }
}

console.log('\npackage-extension.sh zip cleanup:');

// Skip gracefully if `zip` isn't available (the script needs it); the test is
// about cleanup behavior, but the real script zips at the end.
let hasZip = true;
try {
  execFileSync('zip', ['-v'], { stdio: 'ignore' });
} catch {
  hasZip = false;
}

if (!hasZip) {
  console.log('  ⚠️  `zip` not found on PATH — skipping (cannot run real packaging script).');
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
  process.exit(0);
}

const distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sts-dist-'));

// Seed the fixture dist/ with a mix of files:
//   - unrelated loose file            → must survive
//   - unrelated subdirectory + file   → must survive
//   - a zip NOT matching our pattern   → must survive
//   - old zips matching our pattern    → must be removed
const unrelatedFile = path.join(distDir, 'RELEASE_NOTES.md');
const unrelatedDir = path.join(distDir, 'screenshots');
const unrelatedDirFile = path.join(unrelatedDir, 'promo.png');
const foreignZip = path.join(distDir, 'some-other-tool-v9.zip');
const oldZip1 = path.join(distDir, 'simple-tab-summarizer-v1.1.0.zip');
const oldZip2 = path.join(distDir, 'simple-tab-summarizer-v1.2.3.zip');

fs.writeFileSync(unrelatedFile, 'keep me\n');
fs.mkdirSync(unrelatedDir);
fs.writeFileSync(unrelatedDirFile, 'binary-ish');
fs.writeFileSync(foreignZip, 'PK\u0003\u0004 not ours');
fs.writeFileSync(oldZip1, 'PK\u0003\u0004 old');
fs.writeFileSync(oldZip2, 'PK\u0003\u0004 old');

let ranOk = true;
try {
  execFileSync('bash', [SCRIPT], {
    cwd: ROOT_DIR,
    env: { ...process.env, DIST_DIR: distDir },
    stdio: 'pipe'
  });
} catch (err) {
  ranOk = false;
  console.error('  ❌ packaging script exited non-zero:');
  if (err.stdout) console.error(String(err.stdout));
  if (err.stderr) console.error(String(err.stderr));
}

assert(ranOk, 'packaging script ran successfully against the fixture dist');

if (ranOk) {
  // Unrelated content preserved
  assert(fs.existsSync(unrelatedFile), 'unrelated loose file (RELEASE_NOTES.md) is preserved');
  assert(fs.existsSync(unrelatedDir) && fs.statSync(unrelatedDir).isDirectory(),
    'unrelated subdirectory (screenshots/) is preserved');
  assert(fs.existsSync(unrelatedDirFile), 'file inside unrelated subdirectory is preserved');
  assert(fs.existsSync(foreignZip), 'non-matching zip (some-other-tool-v9.zip) is preserved');

  // Old matching zips removed
  assert(!fs.existsSync(oldZip1), 'old matching zip v1.1.0 is removed');
  assert(!fs.existsSync(oldZip2), 'old matching zip v1.2.3 is removed');

  // Exactly one freshly-built matching zip remains
  const remainingOwnZips = fs
    .readdirSync(distDir)
    .filter((f) => /^simple-tab-summarizer-v.*\.zip$/.test(f));
  assert(remainingOwnZips.length === 1,
    `exactly one freshly-built package remains (found ${remainingOwnZips.length}: ${remainingOwnZips.join(', ')})`);
}

// Cleanup the temp fixture
fs.rmSync(distDir, { recursive: true, force: true });

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
