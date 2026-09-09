/**
 * Unit tests for features/summarize.js pure helpers.
 *
 * Run with: node tests/unit/test-summarize.js  (or via npm run test:unit)
 *
 * Focus: downloadProgressText — the gating rule that suppresses the misleading
 * "Downloading on-device model: 100%" flash on warm (already-cached) runs,
 * where Chrome emits a lone downloadprogress event at loaded === 1.
 */

import './chrome-mock.js';

import { downloadProgressText } from '../../features/summarize.js';

let passed = 0;
let failed = 0;

function assertEqual(actual, expected, message) {
  if (actual === expected) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.error(`  ❌ ${message} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
  }
}

console.log('\n🧪 downloadProgressText');

// Warm model: Chrome fires a single 100% event with no prior progress.
// This is the exact bug — it must be suppressed (null → leave text unchanged).
{
  const state = { sawRealDownload: false };
  assertEqual(downloadProgressText(1, state), null,
    'standalone 100% event (cached model) shows no download text');
}

// Cold model: a real download ticks up from a partial fraction, then completes.
{
  const state = { sawRealDownload: false };
  assertEqual(downloadProgressText(0, state), 'Downloading on-device model: 0%',
    'genuine download start (0%) shows download text');
  assertEqual(downloadProgressText(0.42, state), 'Downloading on-device model: 42%',
    'mid-download fraction is rounded and shown');
  assertEqual(downloadProgressText(1, state), 'Downloading on-device model: 100%',
    'completion (100%) is shown once a real download was observed');
}

// A partial event before 100% "arms" the download UI; a later lone-looking
// 100% in the SAME run is still a real completion and must show.
{
  const state = { sawRealDownload: false };
  downloadProgressText(0.9, state);
  assertEqual(downloadProgressText(1, state), 'Downloading on-device model: 100%',
    '100% after observed progress is treated as real completion');
}

// Rounding sanity: fractions round to the nearest integer percent.
{
  const state = { sawRealDownload: true };
  assertEqual(downloadProgressText(0.005, state), 'Downloading on-device model: 1%',
    '0.005 rounds to 1%');
  assertEqual(downloadProgressText(0.004, state), 'Downloading on-device model: 0%',
    '0.004 rounds to 0%');
}

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
