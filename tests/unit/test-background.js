/**
 * Unit tests for background.js logic and api/codex-client.js
 *
 * Run with: npm run test:unit (or: node tests/unit/test-background.js)
 *
 * This test file imports the real modules instead of re-declaring shadow copies,
 * eliminating drift (the old test's MAX_CHARS_PER_TAB was 8000 vs production's 30000).
 */

// ============================================
// Real imports (no more shadow copies)
// ============================================
// chrome-mock.js MUST be imported first: it installs the `chrome` global that
// background.js touches at module top-level. ESM evaluates imports in order.
import './chrome-mock.js';

import {
  buildUserMessage,
  truncateMessage
} from '../../background.js';

import {
  buildInstructions,
  buildRequestBody,
  parseSSEEvent,
  parseSSEResponse,
  classifyResponseError,
  summarizeViaCodex,
  OPENAI_MODEL_CANDIDATES
} from '../../api/codex-client.js';

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
    console.error(`     Expected: "${expected}"`);
    console.error(`     Got:      "${actual}"`);
  }
}

function assertContains(actual, substring, message) {
  if (actual.includes(substring)) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.error(`  ❌ ${message} — expected to contain "${substring}"`);
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

// ============================================
// buildUserMessage / truncateMessage
// ============================================

console.log('\n🧪 Background Logic Tests\n');
console.log('buildUserMessage():');

const singlePage = [{ title: 'Test Page', url: 'https://example.com', content: 'Hello world' }];
const msg1 = buildUserMessage(singlePage);
assertContains(msg1, '=== PAGE 1 ===', 'includes page marker');
assertContains(msg1, 'Title: Test Page', 'includes title');
assertContains(msg1, 'URL: https://example.com', 'includes URL');
assertContains(msg1, 'Hello world', 'includes content');

const multiPage = [
  { title: 'Page 1', url: 'https://example.com/1', content: 'Content 1' },
  { title: 'Page 2', url: 'https://example.com/2', content: 'Content 2' }
];
const msg2 = buildUserMessage(multiPage);
assertContains(msg2, '=== PAGE 1 ===', 'includes first page marker');
assertContains(msg2, '=== PAGE 2 ===', 'includes second page marker');

// Clipping happens at 30000 in production (not 8000 like the old shadow copy).
const longContent = 'x'.repeat(31000);
const clipped = buildUserMessage([{ title: 'Long', url: 'https://example.com', content: longContent }]);
assertContains(clipped, '[content clipped]', 'clips content exceeding MAX_CHARS_PER_TAB (30000)');

const shortEnoughContent = 'x'.repeat(9000);
const notClipped = buildUserMessage([{ title: 'Short', url: 'https://example.com', content: shortEnoughContent }]);
assertTrue(!notClipped.includes('[content clipped]'), 'does NOT clip content under 30000 (parity fix: old shadow copy would have clipped this)');

console.log('\ntruncateMessage():');

assertEqual(truncateMessage('Hello world', 100), 'Hello world', 'does not truncate short messages');

const longMsg = 'a'.repeat(500);
const truncated = truncateMessage(longMsg, 100);
assertEqual(truncated.length, 100 + '\n[content clipped]'.length, 'truncates to maxLength + clip marker');
assertContains(truncated, '[content clipped]', 'adds clip marker');

// ============================================
// buildInstructions
// ============================================

console.log('\nbuildInstructions():');

const shortSingle = buildInstructions('English', 'short', 1);
assertContains(shortSingle, 'Output must be in English', 'includes language directive');
assertContains(shortSingle, 'ONE very concise paragraph', 'includes short single-tab instruction');
assertContains(shortSingle, 'max 80 words', 'includes word limit for short single-tab');

const shortMulti = buildInstructions('English', 'short', 3);
assertContains(shortMulti, 'For each page section marked', 'includes multi-tab instruction');
assertContains(shortMulti, 'max 60 words', 'includes word limit for short multi-tab');

const mediumSingle = buildInstructions('English', 'medium', 1);
assertContains(mediumSingle, 'max 120 words', 'medium single-tab uses 120 word limit');

const detailedSingle = buildInstructions('English', 'detailed', 1);
assertContains(detailedSingle, 'max 300 words', 'detailed single-tab uses 300 word limit');

const detailedMulti = buildInstructions('English', 'detailed', 5);
assertContains(detailedMulti, 'max 250 words', 'detailed multi-tab uses 250 word limit');

const frenchShort = buildInstructions('French', 'short', 1);
assertContains(frenchShort, 'Output must be in French', 'respects language parameter');

// Unknown summaryLevel falls back to short
const unknownLevel = buildInstructions('English', 'nonsense', 1);
assertContains(unknownLevel, 'max 80 words', 'unknown level falls back to short');

// ============================================
// buildRequestBody
// ============================================

console.log('\nbuildRequestBody():');

const body1 = JSON.parse(buildRequestBody('gpt-5.6-luna', 'Test instructions', 'Test message', false));
assertEqual(body1.model, 'gpt-5.6-luna', 'includes model');
assertEqual(body1.instructions, 'Test instructions', 'includes instructions');
assertEqual(body1.store, false, 'sets store to false');
assertEqual(body1.stream, true, 'sets stream to true');
assertTrue(!body1.reasoning, 'omits reasoning when includeReasoning is false');
assertEqual(body1.input[0].content[0].text, 'Test message', 'wraps message in input structure');

const body2 = JSON.parse(buildRequestBody('gpt-5.6-luna', 'x', 'y', true));
assertTrue(body2.reasoning && body2.reasoning.effort === 'low', 'includes reasoning.effort=low when includeReasoning is true');

// ============================================
// parseSSEEvent
// ============================================

console.log('\nparseSSEEvent():');

assertEqual(parseSSEEvent(''), null, 'returns null for empty line');
assertEqual(parseSSEEvent('  '), null, 'returns null for whitespace-only line');
assertEqual(parseSSEEvent(': comment'), null, 'returns null for comment line');
assertEqual(parseSSEEvent('event: some.event'), null, 'returns null for non-data line');

const validEvent = parseSSEEvent('data: {"type": "response.output_text.delta", "delta": "hello"}');
assertEqual(validEvent.type, 'response.output_text.delta', 'parses valid SSE event');
assertEqual(validEvent.delta, 'hello', 'extracts delta field');

// Malformed `data:` payloads must be tolerated regardless of the engine's JSON
// error wording. The parser swallows ANY SyntaxError (not just "Unexpected token")
// so a partial/garbage chunk skips the line instead of aborting the whole stream.
// These inputs produce DIFFERENT V8 error messages — the old substring check
// re-threw several of them, which is the fragility this fixes.
const malformedPayloads = [
  ['data: not json', 'bare word → "Unexpected token \'o\'"'],
  ['data: {invalid json}', "object w/ bad key → \"Expected property name or '}'\""],
  ['data: {', 'truncated object → "Expected property name" (partial chunk)'],
  ['data: [unclosed', 'truncated array'],
  ['data: }', 'stray close brace'],
  ['data: {"a":}', 'missing value'],
  ['data: {"a": 1', 'unterminated object (mid-stream cut)'],
  ['data: "unterminated', 'unterminated string'],
  ['data: undefined', 'JS literal that is not JSON']
];
for (const [line, desc] of malformedPayloads) {
  assertEqual(parseSSEEvent(line), null, `swallows malformed JSON: ${desc}`);
}

// Regression guard: none of the malformed inputs may THROW out of parseSSEEvent.
let anyThrew = false;
for (const [line] of malformedPayloads) {
  try {
    parseSSEEvent(line);
  } catch {
    anyThrew = true;
  }
}
assertTrue(!anyThrew, 'no malformed data: payload throws (engine-independent swallow)');

// A malformed line embedded in an otherwise-valid stream must not lose the good
// content around it — the stream should still accumulate deltas and complete.
const sseWithGarbage = `data: {"type": "response.output_text.delta", "delta": "Good "}
data: {this is broken
data: {"type": "response.output_text.delta", "delta": "content"}
data: {"type": "response.completed"}
`;
assertEqual(await parseSSEResponse(sseWithGarbage), 'Good content',
  'malformed line mid-stream is skipped; surrounding deltas survive');

// ============================================
// classifyResponseError
// ============================================

console.log('\nclassifyResponseError():');

assertEqual(classifyResponseError(401, 'any error'), 'auth', 'classifies 401 as auth');
assertEqual(classifyResponseError(403, 'any error'), 'auth', 'classifies 403 as auth');

assertEqual(classifyResponseError(400, 'Unsupported parameter: reasoning'), 'unsupported-param',
  'classifies "Unsupported parameter" 400 as unsupported-param (existing retry path)');

assertEqual(
  classifyResponseError(400, "The 'gpt-5.4' model is not supported when using Codex with a ChatGPT account."),
  'unsupported-model',
  'accepts the exact user-reported gpt-5.4 rejection'
);
assertEqual(classifyResponseError(400, 'model_not_found'), 'unsupported-model',
  'classifies model_not_found as unsupported-model');
assertEqual(classifyResponseError(400, 'The model is not available'), 'unsupported-model',
  'classifies model not available as unsupported-model');

assertEqual(classifyResponseError(400, 'Some other error'), 'other', 'classifies generic 400 as other');
assertEqual(classifyResponseError(500, 'Server error'), 'other', 'classifies 500 as other');

// ============================================
// parseSSEResponse (string input)
// ============================================

console.log('\nparseSSEResponse() with string input:');

const sseWithDeltas = `event: response.output_text.delta
data: {"type": "response.output_text.delta", "delta": "Hello "}

event: response.output_text.delta
data: {"type": "response.output_text.delta", "delta": "world"}

event: response.completed
data: {"type": "response.completed"}
`;
assertEqual(await parseSSEResponse(sseWithDeltas), 'Hello world', 'parses delta events correctly');

const sseWithDone = `event: response.output_item.done
data: {"type": "response.output_item.done", "item": {"content": [{"text": "Done!"}]}}
`;
assertEqual(await parseSSEResponse(sseWithDone), 'Done!', 'parses output_item.done when no deltas');

// "no deltas → use output_item.done" branch, followed by later deltas being ignored?
// Verify the parity behavior: deltas populate first, output_item.done is ignored.
const sseDeltasAndDone = `data: {"type": "response.output_text.delta", "delta": "Delta wins"}
data: {"type": "response.output_item.done", "item": {"content": [{"text": "should be ignored"}]}}
`;
assertEqual(await parseSSEResponse(sseDeltasAndDone), 'Delta wins',
  'output_item.done is ignored when deltas already received');

const sseEmpty = `event: response.completed
data: {"type": "response.completed"}
`;
assertEqual(await parseSSEResponse(sseEmpty), '[Stream completed with no content]', 'handles empty completed stream');

const sseNoContent = `data: {"type": "response.output_text.delta", "delta": ""}
`;
assertEqual(await parseSSEResponse(sseNoContent), '[No content received from stream]', 'handles no content');

// ============================================
// parseSSEResponse (stream input)
// ============================================

console.log('\nparseSSEResponse() with stream input (mock ReadableStream):');

class MockReadableStream {
  constructor(text) {
    this.text = text;
    this.index = 0;
  }
  getReader() {
    const self = this;
    const encoder = new TextEncoder();
    return {
      async read() {
        if (self.index >= self.text.length) return { done: true };
        // Chunk the stream to exercise the buffer-across-chunks path
        const chunk = self.text.substring(self.index, self.index + 20);
        self.index += 20;
        return { done: false, value: encoder.encode(chunk) };
      },
      releaseLock() {}
    };
  }
}

const streamText = `data: {"type": "response.output_text.delta", "delta": "Stream "}
data: {"type": "response.output_text.delta", "delta": "test"}
data: {"type": "response.completed"}
`;
assertEqual(await parseSSEResponse(new MockReadableStream(streamText)), 'Stream test',
  'parses chunked stream correctly (buffer spans chunks)');

// ============================================
// Model Fallback (via real summarizeViaCodex)
// ============================================

console.log('\n🔄 Model Fallback Tests\n');

assertEqual(OPENAI_MODEL_CANDIDATES[0], 'gpt-5.6-luna', 'primary model is gpt-5.6-luna');
assertEqual(OPENAI_MODEL_CANDIDATES.length, 3, 'has 3 candidates');

const originalFetch = globalThis.fetch;

// Test: first candidate rejected → falls back to second, returns text
let fetchCallCount = 0;
let fetchedModels = [];
globalThis.fetch = async (url, options) => {
  fetchCallCount++;
  fetchedModels.push(JSON.parse(options.body).model);
  if (fetchCallCount === 1) {
    return {
      ok: false,
      status: 400,
      text: async () => "The 'gpt-5.6-luna' model is not supported"
    };
  }
  return {
    ok: true,
    status: 200,
    headers: new Map([['content-type', 'application/json']]),
    text: async () => JSON.stringify({ output_text: 'Summary text' })
  };
};

try {
  const retryResult = await summarizeViaCodex({
    message: 'Test message',
    tabCount: 1,
    accessToken: 'test-token',
    accountId: 'test-account',
    modelCandidates: OPENAI_MODEL_CANDIDATES,
    apiUrl: 'http://test'
  });
  assertEqual(retryResult, 'Summary text', 'fallback retry returns text from second candidate');
  assertEqual(fetchedModels[0], 'gpt-5.6-luna', 'first attempt uses gpt-5.6-luna');
  assertEqual(fetchedModels[1], 'gpt-5.6-terra', 'second attempt uses gpt-5.6-terra');
  assertEqual(fetchCallCount, 2, 'exactly two fetches (no over-retry)');
} finally {
  globalThis.fetch = originalFetch;
}

// Test: "Unsupported parameter" retries the SAME model without reasoning
let paramRetryCount = 0;
let paramRetryBodies = [];
globalThis.fetch = async (url, options) => {
  paramRetryCount++;
  paramRetryBodies.push(JSON.parse(options.body));
  if (paramRetryCount === 1) {
    return {
      ok: false,
      status: 400,
      text: async () => 'Unsupported parameter: reasoning'
    };
  }
  return {
    ok: true,
    status: 200,
    headers: new Map([['content-type', 'application/json']]),
    text: async () => JSON.stringify({ output_text: 'ok' })
  };
};

try {
  await summarizeViaCodex({
    message: 'x',
    tabCount: 1,
    accessToken: 't',
    accountId: 'a',
    modelCandidates: OPENAI_MODEL_CANDIDATES,
    apiUrl: 'http://test'
  });
  assertEqual(paramRetryBodies[0].model, 'gpt-5.6-luna', 'first call: gpt-5.6-luna');
  assertEqual(paramRetryBodies[1].model, 'gpt-5.6-luna', 'second call: SAME model (parameter retry, not candidate advance)');
  assertTrue(!!paramRetryBodies[0].reasoning, 'first call includes reasoning');
  assertTrue(!paramRetryBodies[1].reasoning, 'second call omits reasoning');
} finally {
  globalThis.fetch = originalFetch;
}

// Test: 401 throws auth error message (no retry)
globalThis.fetch = async () => ({
  ok: false,
  status: 401,
  text: async () => 'unauthorized'
});
try {
  let threw = null;
  try {
    await summarizeViaCodex({
      message: 'x',
      tabCount: 1,
      accessToken: 't',
      accountId: 'a',
      modelCandidates: OPENAI_MODEL_CANDIDATES,
      apiUrl: 'http://test'
    });
  } catch (e) {
    threw = e;
  }
  assertTrue(!!threw, '401 causes summarizeViaCodex to throw');
  assertContains(threw ? threw.message : '', 'Authentication failed', '401 error message mentions authentication');
} finally {
  globalThis.fetch = originalFetch;
}

// ============================================
// Abort signal is plumbed through
// ============================================

console.log('\n🛑 Abort Signal Tests\n');

let abortSignalReceived = null;
globalThis.fetch = async (url, options) => {
  abortSignalReceived = options.signal;
  return {
    ok: true,
    status: 200,
    headers: new Map([['content-type', 'application/json']]),
    text: async () => JSON.stringify({ output_text: 'Result' })
  };
};

try {
  const controller = new AbortController();
  await summarizeViaCodex({
    message: 'Test',
    tabCount: 1,
    accessToken: 'test-token',
    accountId: 'test-account',
    signal: controller.signal,
    modelCandidates: OPENAI_MODEL_CANDIDATES,
    apiUrl: 'http://test'
  });
  assertEqual(abortSignalReceived, controller.signal, 'abort signal is passed to fetch');
} finally {
  globalThis.fetch = originalFetch;
}

// ============================================
// Summary
// ============================================

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
