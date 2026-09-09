/**
 * Unit tests for scripts/generate-store-listing.mjs.
 *
 * Covers the pure transform/splice functions (imported directly) plus an
 * end-to-end --check invocation of the real script against temp fixtures, so
 * the CLI wiring is exercised without touching the repo's real files.
 *
 * Run with: node tests/unit/test-store-listing.mjs
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  parseChangelog,
  storeifyBullet,
  buildWhatsNewBlock,
  spliceWhatsNew,
  extractDescriptionBody,
  hasVersionBlock,
} from '../../scripts/generate-store-listing.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT_DIR, 'scripts', 'generate-store-listing.mjs');

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

function assertEqual(actual, expected, message) {
  const ok = actual === expected;
  if (!ok) {
    console.error(`     expected: ${JSON.stringify(expected)}`);
    console.error(`     actual:   ${JSON.stringify(actual)}`);
  }
  assert(ok, message);
}

const SAMPLE_CHANGELOG = `# Changelog

## [1.3.0] - 2026-09-08

### Added
- **Chrome Built-in AI**: Uses Chrome's on-device Summarizer (see [requirements](https://example.com/x)). No \`API key\` needed.
- **Language-Aware Selection**: Handles EN, JA locally.

### Changed
- **Button No Longer Gated**: The old \`hard block\` is removed.

### Tests
- Added E2E tests that should NOT appear in the store block.

---

## [1.2.4] - 2026-08-31

### Fixed
- **Summarization Failure**: Migrated the default model.
`;

// ----------------------------------------------------------------------------
console.log('\nparseChangelog:');

const parsed = parseChangelog(SAMPLE_CHANGELOG);
assert(parsed.has('1.3.0'), 'parses 1.3.0 version header');
assert(parsed.has('1.2.4'), 'parses 1.2.4 version header');
assertEqual(
  parsed.get('1.3.0').subsections.Added.length,
  2,
  '1.3.0 has 2 Added bullets',
);
assertEqual(
  parsed.get('1.3.0').subsections.Changed.length,
  1,
  '1.3.0 has 1 Changed bullet',
);
assert(
  Array.isArray(parsed.get('1.3.0').subsections.Tests),
  'Tests subsection is parsed (but will be excluded from block)',
);

// ----------------------------------------------------------------------------
console.log('\nstoreifyBullet:');

assertEqual(
  storeifyBullet('**Summarization Fix**: Restored summaries'),
  'Summarization Fix: Restored summaries',
  'strips bold prefix, keeps label + colon',
);
assertEqual(
  storeifyBullet('Uses **on-device** model'),
  'Uses on-device model',
  'strips inline bold emphasis',
);
assertEqual(
  storeifyBullet('See [the docs](https://example.com/x) for more'),
  'See the docs for more',
  'strips markdown links to link text',
);
assertEqual(
  storeifyBullet('No `API key` needed'),
  'No API key needed',
  'strips inline code backticks',
);
assertEqual(
  storeifyBullet('Multiple   spaces\tand tabs'),
  'Multiple spaces and tabs',
  'collapses whitespace',
);

// ----------------------------------------------------------------------------
console.log('\nbuildWhatsNewBlock:');

const block = buildWhatsNewBlock('1.3.0', parsed.get('1.3.0'));
assert(block.startsWith("What's new in 1.3.0:"), 'block starts with version header');
assert(
  block.includes('- Chrome Built-in AI: Uses Chrome'),
  'includes transformed Added bullet',
);
assert(
  block.includes('- Button No Longer Gated: The old hard block is removed.'),
  'includes transformed Changed bullet',
);
assert(
  !block.includes('E2E tests'),
  'excludes Tests subsection from the store block',
);
// Order: Added bullets before Changed bullets.
assert(
  block.indexOf('Chrome Built-in AI') < block.indexOf('Button No Longer Gated'),
  'Added bullets precede Changed bullets',
);

// ----------------------------------------------------------------------------
console.log('\nspliceWhatsNew (prepend + replace + static safety):');

const SAMPLE_LISTING = `# Title

## Store Description

Intro prose that must never change.

Features:
- A feature line

What's new in 1.2.4:
- Old fix

What's new in 1.2.3:
- Older fix

How to use:
1. Do a thing

### Permissions Justification

| Permission | Why |
|---|---|
| tabs | reasons |
`;

// Prepend a brand-new version block.
const prepended = spliceWhatsNew(SAMPLE_LISTING, '1.3.0', block);
assert(
  prepended.includes("What's new in 1.3.0:"),
  'prepend: adds the new version block',
);
assert(
  prepended.indexOf("What's new in 1.3.0:") <
    prepended.indexOf("What's new in 1.2.4:"),
  'prepend: new block appears above the previous top block',
);
assert(
  prepended.includes('Intro prose that must never change.'),
  'prepend: static intro prose preserved',
);
assert(
  prepended.includes('| tabs | reasons |'),
  'prepend: Permissions table preserved',
);
assert(
  prepended.includes('How to use:\n1. Do a thing'),
  'prepend: How-to section preserved',
);

// Idempotency: running the prepend result through with the same version = no change.
const twice = spliceWhatsNew(prepended, '1.3.0', block);
assertEqual(twice, prepended, 'idempotent: re-splicing same version is a no-op');

// Replace-in-place: change the block body for an existing version.
const editedBlock = "What's new in 1.3.0:\n- Edited bullet only";
const replaced = spliceWhatsNew(prepended, '1.3.0', editedBlock);
assert(
  replaced.includes('- Edited bullet only'),
  'replace: new bullet body present',
);
assert(
  !replaced.includes('- Chrome Built-in AI: Uses Chrome'),
  'replace: old bullet body removed',
);
assert(
  replaced.includes("What's new in 1.2.4:"),
  'replace: sibling blocks untouched',
);
assert(
  (replaced.match(/What's new in 1\.3\.0:/g) || []).length === 1,
  'replace: no duplicate 1.3.0 block',
);

// Replace the LAST block (edge case: 1.2.3 is last before How to use).
const replacedLast = spliceWhatsNew(SAMPLE_LISTING, '1.2.3', "What's new in 1.2.3:\n- Replaced older");
assert(
  replacedLast.includes('- Replaced older'),
  'replace-last: new body present',
);
assert(
  replacedLast.includes('How to use:\n1. Do a thing'),
  'replace-last: following section preserved',
);
assert(
  !replacedLast.includes('- Older fix'),
  'replace-last: old body removed',
);

// ----------------------------------------------------------------------------
console.log('\nextractDescriptionBody:');

const body = extractDescriptionBody(prepended);
assert(body.startsWith('Intro prose'), 'body starts after the ## heading');
assert(!body.includes('Permissions Justification'), 'body stops before Permissions');
assert(body.includes("What's new in 1.3.0:"), 'body includes the new block');

// ----------------------------------------------------------------------------
console.log('\nCLI --check (end-to-end against temp fixtures):');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sts-listing-'));
const clPath = path.join(tmpDir, 'CHANGELOG.md');
const listPath = path.join(tmpDir, 'STORE_LISTING.md');
fs.writeFileSync(clPath, SAMPLE_CHANGELOG);

// Missing 1.3.0 block → lenient --check must exit non-zero.
fs.writeFileSync(listPath, SAMPLE_LISTING);
let checkExit = 0;
try {
  execFileSync('node', [SCRIPT, '--check', '--version', '1.3.0', '--changelog', clPath, '--listing', listPath], { stdio: 'pipe' });
} catch (e) {
  checkExit = e.status;
}
assert(checkExit === 1, '--check exits 1 when version block is absent');

// Write mode brings it in sync, then --check exits 0.
execFileSync('node', [SCRIPT, '--version', '1.3.0', '--changelog', clPath, '--listing', listPath], { stdio: 'pipe' });
let checkExit2 = 0;
try {
  execFileSync('node', [SCRIPT, '--check', '--version', '1.3.0', '--changelog', clPath, '--listing', listPath], { stdio: 'pipe' });
} catch (e) {
  checkExit2 = e.status;
}
assert(checkExit2 === 0, '--check exits 0 once a block for the version exists');

// Lenient --check tolerates manual polish (block present but reworded).
const polished = fs.readFileSync(listPath, 'utf8').replace(
  '- Chrome Built-in AI: Uses Chrome',
  '- Zero-Auth AI: reworded by a human',
);
fs.writeFileSync(listPath, polished);
let checkExitPolish = 0;
try {
  execFileSync('node', [SCRIPT, '--check', '--version', '1.3.0', '--changelog', clPath, '--listing', listPath], { stdio: 'pipe' });
} catch (e) {
  checkExitPolish = e.status;
}
assert(checkExitPolish === 0, '--check tolerates manually polished wording');

// --check-strict rejects the manual polish (byte-exact required).
let strictExit = 0;
try {
  execFileSync('node', [SCRIPT, '--check-strict', '--version', '1.3.0', '--changelog', clPath, '--listing', listPath], { stdio: 'pipe' });
} catch (e) {
  strictExit = e.status;
}
assert(strictExit === 1, '--check-strict rejects manually polished wording');

const written = fs.readFileSync(listPath, 'utf8');
assert(written.includes("What's new in 1.3.0:"), 'write mode added the 1.3.0 block to the file');
assert(written.includes('Intro prose that must never change.'), 'write mode preserved static prose');

// --stdout prints the description body.
const stdoutText = execFileSync('node', [SCRIPT, '--stdout', '--version', '1.3.0', '--changelog', clPath, '--listing', listPath], { encoding: 'utf8' });
assert(stdoutText.includes("What's new in 1.3.0:"), '--stdout emits the description body with new block');
assert(!stdoutText.includes('Permissions Justification'), '--stdout stops before Permissions');
// The file was manually polished above ("reworded by a human"); --stdout must
// preserve that wording rather than re-emitting the mechanical transform.
assert(
  stdoutText.includes('- Zero-Auth AI: reworded by a human'),
  '--stdout preserves manually polished wording from the current file',
);

fs.rmSync(tmpDir, { recursive: true, force: true });

// ----------------------------------------------------------------------------
console.log('\nhasVersionBlock:');
assert(hasVersionBlock("...What's new in 1.3.0:\n- x", '1.3.0'), 'detects present block');
assert(!hasVersionBlock("...What's new in 1.2.4:\n- x", '1.3.0'), 'detects absent block');

// ----------------------------------------------------------------------------
console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
