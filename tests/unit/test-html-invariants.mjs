/**
 * HTML ↔ code invariants.
 *
 * Static tests (no browser, no jsdom) that guard invariants unit tests on the
 * behavior side can't catch:
 *
 *  1. Every #provider-select option value MUST equal a real provider name from
 *     api/providers/index.js (plus the sentinel 'auto'). If someone renames a
 *     provider without updating the HTML — or vice versa — the option's value
 *     no longer maps to anything and updateProviderSelector's querySelector
 *     silently returns null, so the option keeps its default "Built-in AI" /
 *     "ChatGPT" text with no status marker. Symptom looks like "the feature
 *     forgot to render" — hard to trace at runtime.
 *
 *  2. popup.html and sidebar.html MUST have identical option value lists for
 *     #provider-select. The two files historically drift because one gets
 *     updated and the reviewer doesn't remember the other exists.
 *
 * Run with: node tests/unit/test-html-invariants.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) { passed++; console.log(`  ✅ ${message}`); }
  else { failed++; console.error(`  ❌ ${message}`); }
}
function assertDeepEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`  ✅ ${message}`); }
  else { failed++; console.error(`  ❌ ${message}\n     got:      ${a}\n     expected: ${e}`); }
}

/**
 * Extracts the option `value` attributes from the #provider-select block of
 * an HTML file, in document order. Deliberately regex-based (not jsdom) to
 * keep the test dependency-free.
 */
function extractProviderSelectValues(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  // Match <select ... id="provider-select" ...> ... </select>. Non-greedy body,
  // s flag so `.` crosses newlines. Anchor via the id (the only stable marker;
  // classes and other attributes can change).
  const selectRe = /<select[^>]*\bid="provider-select"[^>]*>([\s\S]*?)<\/select>/;
  const m = html.match(selectRe);
  if (!m) throw new Error(`#provider-select not found in ${path.relative(REPO_ROOT, htmlPath)}`);
  const body = m[1];
  // Collect every <option value="...">, tolerating extra attributes (selected,
  // disabled, title) in any order.
  const optionRe = /<option\b[^>]*\bvalue="([^"]*)"[^>]*>/g;
  const values = [];
  let om;
  while ((om = optionRe.exec(body)) !== null) values.push(om[1]);
  return values;
}

console.log('\n🧪 HTML ↔ providers invariants');

// Load PROVIDERS from the real registry. Chrome-mock is not needed here — the
// providers module only reads the registry array at import; it doesn't hit
// chrome.* at module top level.
const providersMod = await import(pathToFileURL(path.join(REPO_ROOT, 'api', 'providers', 'index.js')).href);
const { PROVIDERS } = providersMod;
assert(Array.isArray(PROVIDERS) && PROVIDERS.length > 0, 'PROVIDERS registry is a non-empty array');

const expectedOptionValues = ['auto', ...PROVIDERS.map(p => p.name)];

const popupValues = extractProviderSelectValues(path.join(REPO_ROOT, 'popup.html'));
const sidebarValues = extractProviderSelectValues(path.join(REPO_ROOT, 'sidebar.html'));

// (1) Both HTML files match the registry exactly, in the same order.
assertDeepEqual(popupValues, expectedOptionValues,
  'popup.html #provider-select option values match [auto, ...PROVIDERS]');
assertDeepEqual(sidebarValues, expectedOptionValues,
  'sidebar.html #provider-select option values match [auto, ...PROVIDERS]');

// (2) popup and sidebar don't drift from each other. Redundant with (1) when
// (1) passes, but keeps the failure message pointed at the right bug if
// someone edits the registry AND one file (leaving the other stale) —
// (1) will fire twice with different mismatches; this asserts the pairing
// specifically.
assertDeepEqual(popupValues, sidebarValues,
  'popup.html and sidebar.html have identical #provider-select option values');

// (3) Every provider name is a plain ascii slug — the querySelector call in
// features/auth.js embeds these into an attribute selector without escaping,
// so unusual characters would break the selector silently.
for (const name of PROVIDERS.map(p => p.name)) {
  assert(/^[a-z0-9-]+$/.test(name), `provider name "${name}" is a safe attribute-selector slug`);
}

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
