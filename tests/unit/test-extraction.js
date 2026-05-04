/**
 * Unit tests for content extraction logic
 * 
 * Run with: node --experimental-vm-modules tests/unit/test-extraction.js
 * Or with a test runner like Jest/Vitest once configured.
 */

// Simulate the Unicode-safe truncate function from content.js
function truncate(text, maxChars = 4000) {
  if (!text) return '';
  return text
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .filter((l, i, a) => i === 0 || l !== a[i - 1])
    // Keep lines with any word characters (Unicode-aware)
    .filter(l => l.length < 3 || /\p{L}|\p{N}/u.test(l))
    .join('\n')
    .substring(0, maxChars);
}

// Test helpers
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
  if (actual === expected) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.error(`  ❌ ${message} — expected: "${expected}", got: "${actual}"`);
  }
}

// Tests
console.log('\n🧪 Content Extraction Tests\n');

console.log('truncate():');
assertEqual(truncate(''), '', 'returns empty string for empty input');
assertEqual(truncate(null), '', 'returns empty string for null input');
assertEqual(truncate(undefined), '', 'returns empty string for undefined input');

assertEqual(truncate('hello\n\n\nworld'), 'hello\nworld', 'collapses multiple newlines');

const longText = 'a'.repeat(5000);
assertEqual(truncate(longText).length, 4000, 'truncates to MAX_CHARS');

assertEqual(truncate('a\na\na\nb'), 'a\nb', 'removes duplicate consecutive lines');

assertEqual(truncate('ab\ncd\nef'), 'ab\ncd\nef', 'keeps lines shorter than 3 chars (filter is l.length < 3)');

assertEqual(truncate('  hello  \n  world  '), 'hello\nworld', 'trims whitespace from lines');

// Unicode/Cyrillic tests
const cyrillicText = 'Привет мир\nЭто тест на кириллице\nСтрока с русским текстом';
assertEqual(truncate(cyrillicText), cyrillicText, 'preserves Cyrillic text');

const chineseText = '你好世界\n这是一个测试\n中文文本';
assertEqual(truncate(chineseText), chineseText, 'preserves Chinese text');

const mixedText = 'Hello мир 世界\nMixed content тест';
assertEqual(truncate(mixedText), mixedText, 'preserves mixed Unicode text');

// Summary
console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
