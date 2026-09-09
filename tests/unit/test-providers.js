/**
 * Unit tests for the api/providers/ registry and the built-in provider.
 *
 * Run with: node tests/unit/test-providers.js  (or via npm run test:unit)
 *
 * We avoid importing background.js here — these tests exercise the pure
 * selection logic and the Chrome-built-in adapter, which only reach for
 * `self.Summarizer` (which we mock) and `chrome.runtime.sendMessage`
 * (which we mock for the ChatGPT path).
 */

import './chrome-mock.js';

import {
  supportsLanguage,
  hasSummarizerApi,
  availability,
  isAvailable as builtinIsAvailable,
  summarize as builtinSummarize,
  SUPPORTED_LANGUAGES
} from '../../api/providers/chrome-builtin.js';

import {
  selectProvider,
  listAvailableProviders,
  PROVIDERS
} from '../../api/providers/index.js';

// ============================================
// Test helpers
// ============================================

let passed = 0;
let failed = 0;

function assertEqual(actual, expected, message) {
  if (actual === expected) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.error(`  ❌ ${message}`);
    console.error(`     Expected: ${JSON.stringify(expected)}`);
    console.error(`     Got:      ${JSON.stringify(actual)}`);
  }
}

function assertTrue(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.error(`  ❌ ${message}`);
  }
}

async function assertThrowsAsync(fn, matcher, message) {
  try {
    await fn();
    failed++;
    console.error(`  ❌ ${message} — expected throw, got resolve`);
  } catch (e) {
    const ok = typeof matcher === 'string' ? e.message.includes(matcher) : matcher(e);
    if (ok) {
      passed++;
      console.log(`  ✅ ${message}`);
    } else {
      failed++;
      console.error(`  ❌ ${message} — threw wrong error: ${e.message}`);
    }
  }
}

// ============================================
// chrome-builtin: supportsLanguage
// ============================================

console.log('\n🧪 chrome-builtin provider\n');
console.log('supportsLanguage():');

assertTrue(supportsLanguage('English'), 'supports English');
assertTrue(supportsLanguage('Japanese'), 'supports Japanese');
assertTrue(supportsLanguage('Spanish'), 'supports Spanish');
assertTrue(supportsLanguage('German'), 'supports German');
assertTrue(supportsLanguage('French'), 'supports French');
assertTrue(!supportsLanguage('Chinese'), 'does NOT support Chinese');
assertTrue(!supportsLanguage('Russian'), 'does NOT support Russian');
assertTrue(!supportsLanguage(''), 'does NOT support empty string');
assertTrue(!supportsLanguage('english'), 'is case-sensitive (matches dropdown values)');
assertEqual(SUPPORTED_LANGUAGES.English, 'en', 'maps English to BCP-47 en');
assertEqual(SUPPORTED_LANGUAGES.Japanese, 'ja', 'maps Japanese to BCP-47 ja');

// ============================================
// chrome-builtin: availability probing
// ============================================

console.log('\nhasSummarizerApi() / availability():');

// No Summarizer global at all → 'unavailable', hasSummarizerApi false
assertTrue(!hasSummarizerApi(), 'hasSummarizerApi is false when Summarizer global is missing');
assertEqual(await availability(), 'unavailable', 'availability returns "unavailable" when API is missing');
assertEqual(await builtinIsAvailable('English'), false, 'isAvailable is false when API is missing');

// Install a fake Summarizer that reports 'available'
const originalSummarizer = globalThis.Summarizer;

function installFakeSummarizer(config) {
  globalThis.Summarizer = {
    async availability() { return config.status; },
    async create(opts) {
      if (config.createThrows) throw new Error(config.createThrows);
      if (opts?.monitor && config.progress) {
        const monitor = {
          _listeners: {},
          addEventListener(evt, cb) { this._listeners[evt] = cb; }
        };
        opts.monitor(monitor);
        for (const loaded of config.progress) {
          monitor._listeners.downloadprogress?.({ loaded });
        }
      }
      return {
        async summarize(text, _summarizeOpts) {
          if (config.summarizeThrows) throw new Error(config.summarizeThrows);
          return config.result ?? `[summary of ${text.length} chars in ${opts.outputLanguage}]`;
        },
        destroy() { config._destroyed = true; }
      };
    }
  };
}

installFakeSummarizer({ status: 'available' });
assertTrue(hasSummarizerApi(), 'hasSummarizerApi is true when Summarizer global exists');
assertEqual(await availability(), 'available', 'availability returns "available"');
assertEqual(await builtinIsAvailable('English'), true, 'isAvailable is true for supported language');
assertEqual(await builtinIsAvailable('Klingon'), false, 'isAvailable is false for unsupported language even when API is present');

installFakeSummarizer({ status: 'downloadable' });
assertEqual(await builtinIsAvailable('English'), true, 'isAvailable is true when model is downloadable');

installFakeSummarizer({ status: 'downloading' });
assertEqual(await builtinIsAvailable('English'), true, 'isAvailable is true when model is downloading');

installFakeSummarizer({ status: 'unavailable' });
assertEqual(await builtinIsAvailable('English'), false, 'isAvailable is false when model is unavailable');

// availability() must swallow errors thrown by the API.
globalThis.Summarizer = { async availability() { throw new Error('boom'); } };
assertEqual(await availability(), 'unavailable', 'availability swallows internal errors and returns "unavailable"');

// Unrecognized status is normalized to 'unavailable'.
globalThis.Summarizer = { async availability() { return 'weird-new-status'; } };
assertEqual(await availability(), 'unavailable', 'availability normalizes unknown statuses to "unavailable"');

// ============================================
// chrome-builtin: summarize()
// ============================================

console.log('\nsummarize():');

// Case 1: happy path — returns text, plumbs language, destroys the session.
const fakeConfig = { status: 'available' };
installFakeSummarizer(fakeConfig);

let capturedCreate = null;
globalThis.Summarizer = {
  async availability() { return 'available'; },
  async create(opts) {
    capturedCreate = opts;
    return {
      async summarize(text) { return `SUMMARY[${text}] lang=${opts.outputLanguage} len=${opts.length}`; },
      destroy() { capturedCreate._destroyed = true; }
    };
  }
};

const out = await builtinSummarize('hello world', { language: 'Japanese', summaryLevel: 'medium', tabCount: 1 });
assertEqual(out, 'SUMMARY[hello world] lang=ja len=medium',
  'summarize() maps Japanese→ja and medium→medium and returns the model output');
assertEqual(capturedCreate.type, 'tldr', 'create() uses type=tldr (prose, matches previous behavior)');
assertEqual(capturedCreate.format, 'plain-text', 'create() uses plain-text format (no markdown noise)');
assertEqual(capturedCreate.outputLanguage, 'ja', 'create() forwards outputLanguage=ja');
assertEqual(capturedCreate.length, 'medium', 'create() forwards length=medium for summaryLevel=medium');
assertTrue(capturedCreate._destroyed, 'summarize() destroys the summarizer session after use');

// Case 2: level mapping (detailed → long)
capturedCreate = null;
await builtinSummarize('x', { language: 'English', summaryLevel: 'detailed', tabCount: 1 });
assertEqual(capturedCreate.length, 'long', 'summaryLevel=detailed maps to length=long');

// Case 3: unknown level defaults to short
capturedCreate = null;
await builtinSummarize('x', { language: 'English', summaryLevel: 'garbage', tabCount: 1 });
assertEqual(capturedCreate.length, 'short', 'unknown summaryLevel falls back to length=short');

// Case 4: unsupported language throws (does NOT silently produce garbage)
await assertThrowsAsync(
  () => builtinSummarize('x', { language: 'Klingon' }),
  'does not support Klingon',
  'summarize() throws for unsupported language'
);

// Case 5: no Summarizer API at all → throws a clear error
delete globalThis.Summarizer;
await assertThrowsAsync(
  () => builtinSummarize('x', { language: 'English' }),
  'Chrome built-in AI',
  'summarize() throws when Summarizer global is missing'
);

// Case 6: session is destroyed even when summarize() throws.
let destroyedOnFailure = false;
globalThis.Summarizer = {
  async availability() { return 'available'; },
  async create() {
    return {
      async summarize() { throw new Error('model exploded'); },
      destroy() { destroyedOnFailure = true; }
    };
  }
};
await assertThrowsAsync(
  () => builtinSummarize('x', { language: 'English' }),
  'model exploded',
  'summarize() re-throws model errors'
);
assertTrue(destroyedOnFailure, 'session is destroyed even when summarize() throws');

// Case 7: download progress callback fires with the observed fractions
const progressSeen = [];
globalThis.Summarizer = {
  async availability() { return 'downloadable'; },
  async create(opts) {
    const monitor = { addEventListener(evt, cb) { monitor[evt] = cb; } };
    opts.monitor(monitor);
    monitor.downloadprogress({ loaded: 0.25 });
    monitor.downloadprogress({ loaded: 1.0 });
    return {
      async summarize() { return 'ok'; },
      destroy() {}
    };
  }
};
await builtinSummarize('x', {
  language: 'English',
  onDownloadProgress: (p) => progressSeen.push(p)
});
assertEqual(progressSeen.length, 2, 'download progress callback fires for each event');
assertEqual(progressSeen[0], 0.25, 'first progress event delivers loaded=0.25');
assertEqual(progressSeen[1], 1.0, 'second progress event delivers loaded=1.0');

// Restore original state.
if (originalSummarizer === undefined) delete globalThis.Summarizer;
else globalThis.Summarizer = originalSummarizer;

// Case 7b (regression): a CACHED model must NOT deliver download progress
// events to the UI. Chrome fires downloadprogress 0 -> 1 on every create(),
// even when availability() is 'available' and no bytes actually move. Relaying
// those flashes a misleading "Downloading 0% -> 100%" on every warm run — the
// exact bug we're locking down. Reproduce with the same event sequence the
// browser emits for a cached model, and assert none of it reaches the caller.
{
  const savedSummarizer = globalThis.Summarizer;
  let monitorAttached = false;
  globalThis.Summarizer = {
    async availability() { return 'available'; },
    async create(opts) {
      if (opts.monitor) {
        monitorAttached = true;
        const m = { addEventListener(evt, cb) { m[evt] = cb; } };
        opts.monitor(m);
        // Simulate the observed browser behavior: fire 0 -> 1 anyway.
        m.downloadprogress?.({ loaded: 0 });
        m.downloadprogress?.({ loaded: 1 });
      }
      return { async summarize() { return 'ok'; }, destroy() {} };
    }
  };

  const seen = [];
  await builtinSummarize('x', {
    language: 'English',
    onDownloadProgress: (p) => seen.push(p)
  });
  assertEqual(seen.length, 0,
    'cached model delivers no download progress events (no misleading flash)');
  assertEqual(monitorAttached, false,
    'monitor is not attached when availability() is "available"');

  if (savedSummarizer === undefined) delete globalThis.Summarizer;
  else globalThis.Summarizer = savedSummarizer;
}

// Case 7c: onModelLoading fires with the correct kind BEFORE create() so the
// UI can show activity on warm runs. 'available' -> 'loading' (cached, spin-up
// only). 'downloadable' -> 'downloading' (real bytes incoming).
{
  const savedSummarizer = globalThis.Summarizer;
  for (const [status, expectedKind] of [
    ['available', 'loading'],
    ['downloadable', 'downloading']
  ]) {
    let createCalled = false;
    let kindAtLoad = null;
    let kindSeenBeforeCreate = false;
    globalThis.Summarizer = {
      async availability() { return status; },
      async create(opts) {
        createCalled = true;
        // Even in the download case, don't fire progress here — we only care
        // that onModelLoading fired first with the right kind.
        if (opts.monitor) {
          const m = { addEventListener(evt, cb) { m[evt] = cb; } };
          opts.monitor(m);
        }
        return { async summarize() { return 'ok'; }, destroy() {} };
      }
    };
    await builtinSummarize('x', {
      language: 'English',
      onModelLoading: (kind) => {
        kindAtLoad = kind;
        // create() must not have been called yet: UI needs the signal upfront.
        kindSeenBeforeCreate = !createCalled;
      }
    });
    assertEqual(kindAtLoad, expectedKind,
      `onModelLoading fires with kind="${expectedKind}" when availability="${status}"`);
    assertEqual(kindSeenBeforeCreate, true,
      `onModelLoading fires BEFORE create() when availability="${status}"`);
  }
  if (savedSummarizer === undefined) delete globalThis.Summarizer;
  else globalThis.Summarizer = savedSummarizer;
}

// Case 8 (regression) is placed after restore so it manages its own mock.
// Gemini Nano rejects oversized input with "The input is too large." — the
// provider must measure against the model's own inputQuota and trim the text
// to fit BEFORE calling summarize(), so callers never see that error on long
// pages. Repro: debug log "Built-in AI failed: The input is too large."
{
  const savedSummarizer = globalThis.Summarizer;
  const INPUT_QUOTA = 4000; // chars
  let receivedLen = null;
  globalThis.Summarizer = {
    async availability() { return 'available'; },
    async create() {
      return {
        inputQuota: INPUT_QUOTA,
        async measureInputUsage(text) { return text.length; },
        async summarize(text) {
          receivedLen = text.length;
          if (text.length > INPUT_QUOTA) {
            throw new Error('The input is too large.');
          }
          return 'ok';
        },
        destroy() {}
      };
    }
  };
  const bigText = 'x'.repeat(30000);
  const out = await builtinSummarize(bigText, { language: 'English', summaryLevel: 'short' });
  assertEqual(out, 'ok', 'summarize() succeeds on oversized input by trimming to inputQuota');
  assertTrue(receivedLen !== null && receivedLen <= INPUT_QUOTA,
    `summarize() trims text to <= inputQuota before calling model (got ${receivedLen} <= ${INPUT_QUOTA})`);
  if (savedSummarizer === undefined) delete globalThis.Summarizer;
  else globalThis.Summarizer = savedSummarizer;
}

// Case 9 (regression): long pages must be summarized in FULL via
// chunk-and-reduce, not truncated to the head. We give the model a small
// quota and an input far larger than it, seeded with distinct markers spread
// end-to-end. Every marker must reach the model across the chunk passes, and
// no summarize() call may exceed the quota.
// See https://developer.chrome.com/docs/ai/scale-summarization
{
  const savedSummarizer = globalThis.Summarizer;
  const QUOTA = 500; // "tokens"; we define 1 token = 10 chars below
  const seenChunks = [];
  let maxUsageSeen = 0;
  globalThis.Summarizer = {
    async availability() { return 'available'; },
    async create() {
      return {
        inputQuota: QUOTA,
        async measureInputUsage(t) { return Math.ceil(t.length / 10); },
        async summarize(t) {
          maxUsageSeen = Math.max(maxUsageSeen, Math.ceil(t.length / 10));
          seenChunks.push(t);
          // Short marker summary that always fits the quota.
          return `S[${t.length}]`;
        },
        destroy() {}
      };
    }
  };
  // 60 markers, each padded so the whole input is ~60k chars (>> quota).
  const NUM_MARKERS = 60;
  const marked = [];
  for (let i = 0; i < NUM_MARKERS; i++) marked.push(`MARK${i}` + 'y'.repeat(990));
  const longText = marked.join('\n\n');
  const chunkOut = await builtinSummarize(longText, { language: 'English', summaryLevel: 'short' });

  assertTrue(typeof chunkOut === 'string' && chunkOut.length > 0,
    'chunk-and-reduce returns a non-empty summary for oversized input');
  const allSeen = seenChunks.join('\u0001');
  const missing = [];
  for (let i = 0; i < NUM_MARKERS; i++) {
    if (!allSeen.includes(`MARK${i}`)) missing.push(i);
  }
  assertTrue(missing.length === 0,
    `chunk-and-reduce covers the whole page — every marker reached the model (missing: ${missing.join(',') || 'none'})`);
  assertTrue(maxUsageSeen <= QUOTA,
    `no summarize() call exceeds the input quota (max usage ${maxUsageSeen} <= ${QUOTA})`);
  assertTrue(seenChunks.length > 1,
    'oversized input is split into multiple model calls (chunk-and-reduce engaged)');
  if (savedSummarizer === undefined) delete globalThis.Summarizer;
  else globalThis.Summarizer = savedSummarizer;
}

// Case 10 (regression): onProgress reports "part N of M" during the chunk map
// pass so long-page summarization doesn't look frozen. It must fire once per
// chunk with a stable total, use phase 'summarizing' on the first pass, and
// NOT fire at all when the input fits in a single call.
{
  const savedSummarizer = globalThis.Summarizer;
  const QUOTA = 500;
  globalThis.Summarizer = {
    async availability() { return 'available'; },
    async create() {
      return {
        inputQuota: QUOTA,
        async measureInputUsage(t) { return Math.ceil(t.length / 10); },
        async summarize() { return 'partial'; },
        destroy() {}
      };
    }
  };

  // --- Large input: progress must fire. ---
  const events = [];
  const longText = Array.from({ length: 40 }, (_, i) => `P${i}` + 'z'.repeat(990)).join('\n\n');
  await builtinSummarize(longText, {
    language: 'English',
    summaryLevel: 'short',
    onProgress: (p) => events.push(p)
  });

  assertTrue(events.length > 0, 'onProgress fires for oversized (chunked) input');
  const firstPass = events.filter((e) => e.phase === 'summarizing');
  assertTrue(firstPass.length > 1,
    'first map pass reports more than one part (page was split)');
  const totalsStable = firstPass.every((e) => e.total === firstPass[0].total);
  assertTrue(totalsStable,
    `"of M" total is stable across the map pass (got ${firstPass.map((e) => e.total).join(',')})`);
  const currentsSequential = firstPass.every((e, i) => e.current === i + 1);
  assertTrue(currentsSequential,
    `part numbers count up 1..M without gaps (got ${firstPass.map((e) => e.current).join(',')})`);
  assertTrue(firstPass[firstPass.length - 1].current === firstPass[0].total,
    'the last announced part equals the announced total (N of M ends at M)');

  // --- Small input: progress must NOT fire (single-shot path). ---
  const smallEvents = [];
  await builtinSummarize('short text that easily fits', {
    language: 'English',
    summaryLevel: 'short',
    onProgress: (p) => smallEvents.push(p)
  });
  assertTrue(smallEvents.length === 0,
    'onProgress does NOT fire when input fits in a single summarize() call');

  if (savedSummarizer === undefined) delete globalThis.Summarizer;
  else globalThis.Summarizer = savedSummarizer;
}

// ============================================
// api/providers/index.js: selectProvider / listAvailableProviders
// ============================================

console.log('\n🧪 provider registry\n');
console.log('selectProvider() / listAvailableProviders():');

// The registry has both providers. To test selection logic hermetically we
// swap in mock providers via the exported PROVIDERS array. Save + restore.
const originalRegistry = [...PROVIDERS];

function setRegistry(providers) {
  PROVIDERS.length = 0;
  for (const p of providers) PROVIDERS.push(p);
}

function mockProvider(name, { supports = null, available = true, summarizeReturn = 'mock' } = {}) {
  return {
    name,
    impl: {
      supportsLanguage: supports ? (lang) => supports.includes(lang) : undefined,
      isAvailable: async () => available,
      summarize: async () => summarizeReturn
    }
  };
}

// Case A: built-in first when both are available.
setRegistry([
  mockProvider('chrome-builtin', { supports: ['English', 'Japanese'], available: true }),
  mockProvider('chatgpt-codex', { available: true })
]);
let picked = await selectProvider('English', { isAuthenticated: true });
assertEqual(picked?.name, 'chrome-builtin', 'selectProvider picks built-in when both available for English');

picked = await selectProvider('Japanese', { isAuthenticated: true });
assertEqual(picked?.name, 'chrome-builtin', 'selectProvider picks built-in for Japanese (supported)');

// Case B: language unsupported by built-in → falls back to ChatGPT if auth.
picked = await selectProvider('Chinese', { isAuthenticated: true });
assertEqual(picked?.name, 'chatgpt-codex', 'selectProvider falls back to ChatGPT for unsupported language when authed');

// Case C: language unsupported by built-in AND not authed → null (no provider).
setRegistry([
  mockProvider('chrome-builtin', { supports: ['English'], available: true }),
  mockProvider('chatgpt-codex', { available: false })
]);
picked = await selectProvider('Chinese', { isAuthenticated: false });
assertEqual(picked, null, 'selectProvider returns null when no provider can handle the request');

// Case D: built-in unavailable, authed → ChatGPT.
setRegistry([
  mockProvider('chrome-builtin', { supports: ['English'], available: false }),
  mockProvider('chatgpt-codex', { available: true })
]);
picked = await selectProvider('English', { isAuthenticated: true });
assertEqual(picked?.name, 'chatgpt-codex', 'selectProvider falls back to ChatGPT when built-in is unavailable');

// Case E: listAvailableProviders returns all matches, not just the first.
setRegistry([
  mockProvider('chrome-builtin', { supports: ['English'], available: true }),
  mockProvider('chatgpt-codex', { available: true })
]);
let list = await listAvailableProviders('English', { isAuthenticated: true });
assertEqual(list.length, 2, 'listAvailableProviders returns both when both apply');
assertEqual(list.map(p => p.name).join(','), 'chrome-builtin,chatgpt-codex', 'listAvailableProviders preserves priority order');

list = await listAvailableProviders('Chinese', { isAuthenticated: true });
assertEqual(list.length, 1, 'listAvailableProviders excludes built-in for unsupported language');
assertEqual(list[0].name, 'chatgpt-codex', 'listAvailableProviders returns only ChatGPT for unsupported language');

// Reset registry with auth-aware ChatGPT mock for the "nothing applies" case.
setRegistry([
  mockProvider('chrome-builtin', { supports: ['English'], available: true }),
  mockProvider('chatgpt-codex', { available: false })
]);
list = await listAvailableProviders('Chinese', { isAuthenticated: false });
assertEqual(list.length, 0, 'listAvailableProviders returns [] when nothing applies');

// Case F: user provider preference.
// F1: preference=chatgpt-codex wins over built-in when ChatGPT is usable.
setRegistry([
  mockProvider('chrome-builtin', { supports: ['English'], available: true }),
  mockProvider('chatgpt-codex', { available: true })
]);
picked = await selectProvider('English', { isAuthenticated: true, preference: 'chatgpt-codex' });
assertEqual(picked?.name, 'chatgpt-codex', 'preference=chatgpt-codex is honored over built-in for English');

// F2: preference=chrome-builtin keeps built-in (same as auto here, but explicit).
picked = await selectProvider('English', { isAuthenticated: true, preference: 'chrome-builtin' });
assertEqual(picked?.name, 'chrome-builtin', 'preference=chrome-builtin is honored');

// F3: preference=chatgpt-codex but ChatGPT unavailable → falls back to built-in.
setRegistry([
  mockProvider('chrome-builtin', { supports: ['English'], available: true }),
  mockProvider('chatgpt-codex', { available: false })
]);
picked = await selectProvider('English', { isAuthenticated: false, preference: 'chatgpt-codex' });
assertEqual(picked?.name, 'chrome-builtin', 'preference=chatgpt-codex falls back to built-in when ChatGPT unusable');

// F4: preference=chrome-builtin but language unsupported → falls back to ChatGPT.
setRegistry([
  mockProvider('chrome-builtin', { supports: ['English'], available: true }),
  mockProvider('chatgpt-codex', { available: true })
]);
picked = await selectProvider('Chinese', { isAuthenticated: true, preference: 'chrome-builtin' });
assertEqual(picked?.name, 'chatgpt-codex', 'preference=chrome-builtin falls back to ChatGPT for unsupported language');

// F5: preference=auto behaves like the default priority order.
picked = await selectProvider('English', { isAuthenticated: true, preference: 'auto' });
assertEqual(picked?.name, 'chrome-builtin', 'preference=auto uses registry priority (built-in first)');

// Restore original registry so other tests see the real providers.
setRegistry(originalRegistry);

// ============================================
// Summary
// ============================================

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
