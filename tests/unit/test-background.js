/**
 * Unit tests for background.js logic
 * 
 * Run with: node tests/unit/test-background.js
 */

// ============================================
// Simulated functions from background.js
// ============================================

function buildUserMessage(contents) {
  const MAX_CHARS_PER_TAB = 8000;
  let message = '';
  
  contents.forEach((content, index) => {
    const clippedContent = content.content.length > MAX_CHARS_PER_TAB
      ? content.content.substring(0, MAX_CHARS_PER_TAB) + '\n[content clipped]'
      : content.content;
    message += `=== PAGE ${index + 1} ===\n`;
    message += `Title: ${content.title}\n`;
    message += `URL: ${content.url}\n`;
    message += `${clippedContent}\n\n`;
  });
  
  return message;
}

function truncateMessage(message, maxLength) {
  if (message.length <= maxLength) return message;
  return message.substring(0, maxLength) + '\n[content clipped]';
}

function parseSSEText(text) {
  const lines = text.split('\n');
  let fullText = '';
  let completed = false;
  let receivedDeltas = false;
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(':')) continue;
    
    if (trimmed.startsWith('data:')) {
      const dataStr = trimmed.substring(5).trim();
      try {
        const event = JSON.parse(dataStr);
        const eventType = event.type;
        
        if (eventType === 'response.output_text.delta' && event.delta) {
          fullText += event.delta;
          receivedDeltas = true;
        } else if (eventType === 'response.output_item.done') {
          if (!receivedDeltas) {
            const item = event.item;
            if (item && item.content) {
              for (const c of item.content) {
                if (c.text) fullText += c.text;
              }
            }
          }
        } else if (eventType === 'response.completed') {
          completed = true;
        } else if (eventType === 'response.error') {
          // Record error but don't throw to avoid local catch warning
          fullText = '[Stream error: ' + (event.error?.message || 'unknown') + ']';
          completed = true;
        }
      } catch (e) {
        if (e.message && !e.message.includes('Unexpected token')) {
          fullText = '[Parse error]';
          completed = true;
        }
      }
    }
  }
  
  if (!fullText && !completed) {
    return '[No content received from stream]';
  }
  
  return fullText || '[Stream completed with no content]';
}

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

function assertThrows(fn, message) {
  try {
    fn();
    failed++;
    console.error(`  ❌ ${message} — expected to throw`);
  } catch {
    passed++;
    console.log(`  ✅ ${message}`);
  }
}

// ============================================
// Tests
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

// Test clipping
const longContent = 'x'.repeat(9000);
const clipped = buildUserMessage([{ title: 'Long', url: 'https://example.com', content: longContent }]);
assertContains(clipped, '[content clipped]', 'clips content exceeding MAX_CHARS_PER_TAB');

console.log('\ntruncateMessage():');

const shortMsg = 'Hello world';
assertEqual(truncateMessage(shortMsg, 100), 'Hello world', 'does not truncate short messages');

const longMsg = 'a'.repeat(500);
const truncated = truncateMessage(longMsg, 100);
assertEqual(truncated.length, 100 + '\n[content clipped]'.length, 'truncates to maxLength + clip marker');
assertContains(truncated, '[content clipped]', 'adds clip marker');

console.log('\nparseSSEText():');

const sseWithDeltas = `event: response.output_text.delta
data: {"type": "response.output_text.delta", "delta": "Hello "}

event: response.output_text.delta
data: {"type": "response.output_text.delta", "delta": "world"}

event: response.completed
data: {"type": "response.completed"}
`;
assertEqual(parseSSEText(sseWithDeltas), 'Hello world', 'parses delta events correctly');

const sseWithDone = `event: response.output_item.done
data: {"type": "response.output_item.done", "item": {"content": [{"text": "Done!"}]}}
`;
assertEqual(parseSSEText(sseWithDone), 'Done!', 'parses output_item.done when no deltas');

const sseEmpty = `event: response.completed
data: {"type": "response.completed"}
`;
assertEqual(parseSSEText(sseEmpty), '[Stream completed with no content]', 'handles empty stream');

const sseNoContent = `data: {"type": "response.output_text.delta", "delta": ""}
`;
assertEqual(parseSSEText(sseNoContent), '[No content received from stream]', 'handles no content');

// ============================================
// Cancellation / Abort tests
// ============================================

console.log('\n🛑 Cancellation Tests\n');

// Simulated abort controller behavior
class MockAbortController {
  constructor() {
    this.signal = { aborted: false };
  }
  abort() {
    this.signal.aborted = true;
  }
}

// Simulated handleSummarizeRequest with cancellation support
let currentSummarizationAbortController = null;

async function simulateHandleSummarizeRequest() {
  currentSummarizationAbortController = new MockAbortController();
  const { signal } = currentSummarizationAbortController;
  
  try {
    // Simulate async work
    await new Promise((resolve, reject) => {
      setTimeout(() => {
        if (signal.aborted) {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        } else {
          resolve('Summary text');
        }
      }, 10);
    });
    
    currentSummarizationAbortController = null;
    return { text: 'Summary text', error: null };
  } catch (error) {
    currentSummarizationAbortController = null;
    if (error.name === 'AbortError') {
      return { text: null, error: 'Summarization was stopped.' };
    }
    return { text: null, error: `Failed: ${error.message}` };
  }
}

function simulateStopSummarize() {
  if (currentSummarizationAbortController) {
    currentSummarizationAbortController.abort();
    currentSummarizationAbortController = null;
  }
}

// Test: Normal summarization completes
console.log('handleSummarizeRequest (normal):');
const normalResult = await simulateHandleSummarizeRequest(false);
assertEqual(normalResult.text, 'Summary text', 'returns summary on success');
assertEqual(normalResult.error, null, 'no error on success');
assertEqual(currentSummarizationAbortController, null, 'abort controller cleared after success');

// Test: Aborted summarization returns stopped message
console.log('\nhandleSummarizeRequest (aborted):');
const abortPromise = simulateHandleSummarizeRequest(false);
// Simulate stop after a short delay
setTimeout(() => simulateStopSummarize(), 5);
const abortedResult = await abortPromise;
assertEqual(abortedResult.text, null, 'no text on abort');
assertEqual(abortedResult.error, 'Summarization was stopped.', 'returns stopped message on abort');
assertEqual(currentSummarizationAbortController, null, 'abort controller cleared after abort');

// Test: Stop when no active summarization is a no-op
console.log('\nstop_summarize (no active summarization):');
currentSummarizationAbortController = null;
simulateStopSummarize();
assertEqual(currentSummarizationAbortController, null, 'no-op when no active summarization');

// Summary
console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
