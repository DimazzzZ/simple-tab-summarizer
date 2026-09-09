/**
 * Unit tests for features/auth.js updateProviderSelector — the logic that
 * moves provider readiness INTO the <select>'s option labels (✓ ready,
 * ↓ downloads on first use, disabled + reason when unusable), replacing the
 * old separate #auth-text label.
 *
 * Run with: node tests/unit/test-auth-ui.js  (or via npm run test:unit)
 *
 * No jsdom in this project, so we use a tiny hand-rolled <select> stub that
 * implements only the surface updateProviderSelector touches: querySelector
 * for option[value=...], .options, .selectedIndex, .value.
 */

import './chrome-mock.js';

import { updateProviderSelector, updateAuthUI } from '../../features/auth.js';
import { SUPPORTED_LANGUAGES } from '../../api/providers/chrome-builtin.js';

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

// --- Minimal <select> stub --------------------------------------------------
function makeOption(value) {
  return { value, textContent: value, title: '', disabled: false };
}
function makeSelect(initialValue = 'auto') {
  const options = [makeOption('auto'), makeOption('chrome-builtin'), makeOption('chatgpt-codex')];
  const select = {
    options,
    _value: initialValue,
    get value() { return this._value; },
    set value(v) { this._value = v; },
    get selectedIndex() { return options.findIndex(o => o.value === this._value); },
    title: '',
    querySelector(sel) {
      const m = /option\[value="(.+?)"\]/.exec(sel);
      return m ? options.find(o => o.value === m[1]) || null : null;
    }
  };
  return select;
}
function opt(select, value) { return select.options.find(o => o.value === value); }

console.log('\n🧪 updateProviderSelector');

// Built-in cached + signed in: both concrete providers usable, ✓ marks.
{
  const select = makeSelect('auto');
  updateProviderSelector({ providerSelect: select }, {
    authenticated: true, builtinReady: true, builtinDownloadable: false,
    builtinSupportsLanguage: true, hasChatgpt: true, language: 'English', preference: 'auto'
  });
  assertEqual(opt(select, 'chrome-builtin').textContent, 'Built-in AI ✓', 'cached built-in shows ✓');
  assertEqual(opt(select, 'chrome-builtin').disabled, false, 'cached built-in is enabled');
  assertEqual(opt(select, 'chatgpt-codex').textContent, 'ChatGPT ✓', 'signed-in ChatGPT shows ✓');
  assertEqual(opt(select, 'chatgpt-codex').disabled, false, 'signed-in ChatGPT is enabled');
  assertEqual(opt(select, 'auto').textContent, 'Auto (Built-in AI)', 'Auto resolves to Built-in AI when cached');
}

// Built-in downloadable (not yet cached): ↓ mark, still selectable.
{
  const select = makeSelect('auto');
  updateProviderSelector({ providerSelect: select }, {
    authenticated: false, builtinReady: false, builtinDownloadable: true,
    builtinSupportsLanguage: true, hasChatgpt: false, language: 'English', preference: 'auto'
  });
  assertEqual(opt(select, 'chrome-builtin').textContent, 'Built-in AI ↓', 'downloadable built-in shows ↓');
  assertEqual(opt(select, 'chrome-builtin').disabled, false, 'downloadable built-in is selectable');
  assertEqual(opt(select, 'auto').textContent, 'Auto (Built-in AI ↓)', 'Auto resolves to Built-in AI ↓ when downloadable');
}

// Not signed in: ChatGPT disabled with a reason.
{
  const select = makeSelect('auto');
  updateProviderSelector({ providerSelect: select }, {
    authenticated: false, builtinReady: true, builtinDownloadable: false,
    builtinSupportsLanguage: true, hasChatgpt: false, language: 'English', preference: 'auto'
  });
  assertEqual(opt(select, 'chatgpt-codex').textContent, 'ChatGPT — sign in needed', 'unauthenticated ChatGPT labels reason');
  assertEqual(opt(select, 'chatgpt-codex').disabled, true, 'unauthenticated ChatGPT is disabled');
}

// Language unsupported by built-in: built-in disabled with a reason.
{
  const select = makeSelect('auto');
  updateProviderSelector({ providerSelect: select }, {
    authenticated: true, builtinReady: false, builtinDownloadable: false,
    builtinSupportsLanguage: false, hasChatgpt: true, language: 'Italian', preference: 'auto'
  });
  assertEqual(opt(select, 'chrome-builtin').textContent, 'Built-in AI — no Italian', 'unsupported language labels reason');
  assertEqual(opt(select, 'chrome-builtin').disabled, true, 'unsupported-language built-in is disabled');
  assertEqual(opt(select, 'auto').textContent, 'Auto (ChatGPT)', 'Auto resolves to ChatGPT when built-in unusable but signed in');
}

// Selection on a now-disabled option falls back to Auto.
{
  const select = makeSelect('chatgpt-codex'); // user had picked ChatGPT
  const result = updateProviderSelector({ providerSelect: select }, {
    authenticated: false, builtinReady: true, builtinDownloadable: false,
    builtinSupportsLanguage: true, hasChatgpt: false, language: 'English', preference: 'chatgpt-codex'
  });
  assertEqual(select.value, 'auto', 'selection falls back to Auto when chosen provider becomes disabled');
  assertEqual(result.fellBackToAuto, true, 'fellBackToAuto=true reported to caller when fallback occurred');
}

// No fallback needed → fellBackToAuto=false (so caller knows not to touch storage).
{
  const select = makeSelect('auto');
  const result = updateProviderSelector({ providerSelect: select }, {
    authenticated: true, builtinReady: true, builtinDownloadable: false,
    builtinSupportsLanguage: true, hasChatgpt: true, language: 'English', preference: 'auto'
  });
  assertEqual(result.fellBackToAuto, false, 'fellBackToAuto=false when the selection is still usable');
}

// Missing providerSelect: no throw AND fellBackToAuto=false (contract for caller).
{
  const result = updateProviderSelector({ providerSelect: null }, {
    authenticated: false, builtinReady: false, builtinDownloadable: false,
    builtinSupportsLanguage: true, hasChatgpt: false, language: 'English', preference: 'auto'
  });
  assertEqual(result.fellBackToAuto, false, 'fellBackToAuto=false when providerSelect is absent');
}

// Nothing available: Auto has no resolved hint, ✓/↓ absent.
{
  const select = makeSelect('auto');
  updateProviderSelector({ providerSelect: select }, {
    authenticated: false, builtinReady: false, builtinDownloadable: false,
    builtinSupportsLanguage: false, hasChatgpt: false, language: 'Italian', preference: 'auto'
  });
  assertEqual(opt(select, 'auto').textContent, 'Auto', 'Auto stays plain when nothing is available');
  assertEqual(opt(select, 'chrome-builtin').disabled, true, 'built-in disabled when unusable');
  assertEqual(opt(select, 'chatgpt-codex').disabled, true, 'ChatGPT disabled when unusable');
}

// ---------------------------------------------------------------------------
// updateAuthUI matrix — the OUTER function. Previously untested; it handles
// icon class, button visibility, connect-button emphasis, and passes the
// builtinStatus mapping through to updateProviderSelector.
// ---------------------------------------------------------------------------

/** Minimal DOM stub covering everything updateAuthUI reads/writes. */
function makeAuthDom(providerSelectValue = 'auto') {
  function makeClassList() {
    const set = new Set();
    return {
      _set: set,
      add: (...c) => c.forEach(x => set.add(x)),
      remove: (...c) => c.forEach(x => set.delete(x)),
      toggle: (c, on) => { if (on === undefined) { set.has(c) ? set.delete(c) : set.add(c); } else { on ? set.add(c) : set.delete(c); } },
      contains: (c) => set.has(c)
    };
  }
  // Connect button has a `.btn-text` child that receives the label. The stub
  // mirrors that so the auth.js `setConnectBtnText` path takes the querySelector
  // branch (matching real popup.html/sidebar.html markup).
  const btnText = { textContent: '' };
  const connectBtn = {
    classList: makeClassList(),
    disabled: false,
    querySelector: (sel) => (sel === '.btn-text' ? btnText : null),
    // If setConnectBtnText ever falls back to textContent, we surface it here.
    textContent: ''
  };
  return {
    authIcon: { classList: makeClassList(), innerHTML: '' },
    connectBtn,
    _connectBtnText: btnText,
    disconnectBtn: { classList: makeClassList() },
    providerSelect: makeSelect(providerSelectValue)
  };
}

function labelOf(dom) { return dom._connectBtnText.textContent; }

// Authenticated: connected icon, connect hidden, disconnect visible.
{
  const dom = makeAuthDom('auto');
  updateAuthUI(dom, true, ['chrome-builtin', 'chatgpt-codex'], 'English', 'auto', 'available');
  assertEqual(dom.authIcon.classList.contains('connected'), true, 'authenticated → icon.connected');
  assertEqual(dom.authIcon.classList.contains('disconnected'), false, 'authenticated → icon !disconnected');
  assertEqual(dom.connectBtn.classList.contains('hidden'), true, 'authenticated → connect hidden');
  assertEqual(dom.disconnectBtn.classList.contains('hidden'), false, 'authenticated → disconnect visible');
}

// Not authenticated, built-in ready → sign-in is OPTIONAL: subtle emphasis + soft label.
{
  const dom = makeAuthDom('auto');
  updateAuthUI(dom, false, ['chrome-builtin'], 'English', 'auto', 'available');
  assertEqual(dom.authIcon.classList.contains('disconnected'), true, 'unauth → icon.disconnected');
  assertEqual(dom.connectBtn.classList.contains('hidden'), false, 'unauth → connect visible');
  assertEqual(dom.disconnectBtn.classList.contains('hidden'), true, 'unauth → disconnect hidden');
  assertEqual(dom.connectBtn.classList.contains('btn-subtle'), true, 'built-in ready → subtle connect');
  assertEqual(labelOf(dom), 'Sign in to ChatGPT', 'built-in ready → soft label');
}

// Not authenticated, built-in downloadable → still counts as "available", so still subtle.
{
  const dom = makeAuthDom('auto');
  updateAuthUI(dom, false, ['chrome-builtin'], 'English', 'auto', 'downloadable');
  assertEqual(dom.connectBtn.classList.contains('btn-subtle'), true, 'built-in downloadable → subtle connect');
  assertEqual(labelOf(dom), 'Sign in to ChatGPT', 'built-in downloadable → soft label');
  // And the built-in option carries the ↓ marker (verifies builtinStatus made it through).
  assertEqual(opt(dom.providerSelect, 'chrome-builtin').textContent, 'Built-in AI ↓',
    'builtinStatus=downloadable → option shows ↓');
}

// Not authenticated, built-in downloading → treated the same as downloadable.
{
  const dom = makeAuthDom('auto');
  updateAuthUI(dom, false, ['chrome-builtin'], 'English', 'auto', 'downloading');
  assertEqual(opt(dom.providerSelect, 'chrome-builtin').textContent, 'Built-in AI ↓',
    'builtinStatus=downloading maps to same ↓ label as downloadable');
  assertEqual(dom.connectBtn.classList.contains('btn-subtle'), true, 'downloading → subtle connect (built-in counts)');
}

// Not authenticated, built-in unavailable → sign-in is the only path: primary + firm label.
{
  const dom = makeAuthDom('auto');
  updateAuthUI(dom, false, [], 'English', 'auto', 'unavailable');
  assertEqual(dom.connectBtn.classList.contains('btn-subtle'), false, 'nothing available → primary connect');
  assertEqual(labelOf(dom), 'Sign in', 'nothing available → firm label');
}

// Not authenticated, language unsupported by built-in → also primary + firm.
{
  const dom = makeAuthDom('auto');
  updateAuthUI(dom, false, [], 'Italian', 'auto', 'available');
  assertEqual(dom.connectBtn.classList.contains('btn-subtle'), false, 'lang unsupported → primary connect');
  assertEqual(labelOf(dom), 'Sign in', 'lang unsupported → firm label');
}

// builtinStatus=null (older/absent) → falls back to the boolean `hasBuiltin`.
{
  const dom = makeAuthDom('auto');
  updateAuthUI(dom, false, ['chrome-builtin'], 'English', 'auto', null);
  // With hasBuiltin=true and no status, treated as ready.
  assertEqual(opt(dom.providerSelect, 'chrome-builtin').textContent, 'Built-in AI ✓',
    'builtinStatus=null + hasBuiltin=true → ✓ (legacy boolean fallback)');
  assertEqual(dom.connectBtn.classList.contains('btn-subtle'), true, 'null status + hasBuiltin → subtle');
}

// Return contract: updateAuthUI propagates {fellBackToAuto} from the selector.
{
  const dom = makeAuthDom('chatgpt-codex'); // user picked ChatGPT
  const result = updateAuthUI(dom, false, ['chrome-builtin'], 'English', 'chatgpt-codex', 'available');
  assertEqual(result && result.fellBackToAuto, true,
    'updateAuthUI returns {fellBackToAuto:true} when the selector had to reset');
  assertEqual(dom.providerSelect.value, 'auto', 'selector value also reset to auto');
}

// ---------------------------------------------------------------------------
// BUILTIN_LANGUAGES drift guard: the auth-layer list must match the provider.
// (Belt-and-suspenders — auth.js also derives it via Object.keys at import.)
// ---------------------------------------------------------------------------
{
  // We can't import the auth-internal BUILTIN_LANGUAGES directly, but every
  // language in SUPPORTED_LANGUAGES must yield builtinSupportsLanguage=true
  // (option NOT disabled with the "no <lang>" reason) and every non-listed
  // language must yield the "no <lang>" branch.
  const supported = Object.keys(SUPPORTED_LANGUAGES);
  for (const lang of supported) {
    const dom = makeAuthDom('auto');
    updateAuthUI(dom, false, ['chrome-builtin'], lang, 'auto', 'available');
    const label = opt(dom.providerSelect, 'chrome-builtin').textContent;
    assertEqual(label.startsWith('Built-in AI'), true, `SUPPORTED lang "${lang}" recognized by auth layer`);
    assertEqual(label.includes('— no '), false, `SUPPORTED lang "${lang}" NOT flagged as unsupported`);
  }
  // Sanity: a language not in the map is flagged unsupported.
  const dom = makeAuthDom('auto');
  updateAuthUI(dom, false, [], 'Klingon', 'auto', 'unavailable');
  assertEqual(opt(dom.providerSelect, 'chrome-builtin').textContent, 'Built-in AI — no Klingon',
    'unlisted language flagged as unsupported');
}

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
