/**
 * Provider registry and selection logic.
 *
 * Orchestrates which summarization provider to use based on:
 *   - language support (Chrome built-in only supports 5 languages)
 *   - availability (built-in may not be available on older Chrome)
 *   - user authentication (ChatGPT requires sign-in)
 *
 * The registry is pure — no side effects, no chrome.* calls of its own. It's
 * fully testable with mock provider objects (see tests/unit/test-providers.js).
 */

import * as chromeBuiltin from './chrome-builtin.js';
import * as chatgptCodex from './chatgpt-codex.js';

/**
 * All providers in priority order (built-in first, then ChatGPT).
 */
const PROVIDERS = [
  { name: 'chrome-builtin', impl: chromeBuiltin },
  { name: 'chatgpt-codex', impl: chatgptCodex }
];

/**
 * Selects the best provider for a given language and auth state.
 *
 * Returns the first provider that:
 *   1. Supports the requested language (if it declares supportsLanguage)
 *   2. Is available (or can be made available)
 *
 * Returns null if no provider can handle the request.
 *
 * @param {string} language human-readable language name
 * @param {object} [ctx] context passed to provider.isAvailable()
 * @param {boolean} [ctx.isAuthenticated] pre-resolved auth state
 * @param {string} [ctx.preference] user's preferred provider name
 *        ('chrome-builtin' | 'chatgpt-codex' | 'auto'). When set to a concrete
 *        provider that is usable for this language, it wins. 'auto' (default)
 *        falls back to registry priority order (built-in first).
 * @returns {Promise<{name:string, impl:object}|null>}
 */
export async function selectProvider(language = 'English', ctx = {}) {
  const preference = ctx.preference || 'auto';

  // Honor an explicit preference first: if the preferred provider supports the
  // language and is available, use it. If it can't (e.g. built-in doesn't
  // support the language, or ChatGPT isn't signed in), fall through to auto so
  // the user still gets a working summary rather than a hard failure.
  if (preference !== 'auto') {
    const preferred = PROVIDERS.find(p => p.name === preference);
    if (preferred) {
      const langOk = !preferred.impl.supportsLanguage || preferred.impl.supportsLanguage(language);
      if (langOk && await preferred.impl.isAvailable(language, ctx)) {
        return preferred;
      }
    }
  }

  for (const provider of PROVIDERS) {
    if (provider.impl.supportsLanguage && !provider.impl.supportsLanguage(language)) {
      continue;
    }
    if (await provider.impl.isAvailable(language, ctx)) {
      return provider;
    }
  }
  return null;
}

/**
 * Lists all providers that can handle a given language.
 *
 * @param {string} language human-readable language name
 * @param {object} [ctx] context passed to provider.isAvailable()
 * @returns {Promise<Array<{name:string, impl:object}>>}
 */
export async function listAvailableProviders(language = 'English', ctx = {}) {
  const available = [];
  for (const provider of PROVIDERS) {
    if (provider.impl.supportsLanguage && !provider.impl.supportsLanguage(language)) {
      continue;
    }
    if (await provider.impl.isAvailable(language, ctx)) {
      available.push(provider);
    }
  }
  return available;
}

/**
 * Runs a summarization using the best available provider.
 *
 * @param {*} contents the content to summarize (shape depends on provider)
 * @param {object} [opts]
 * @param {string} [opts.language] output language
 * @param {string} [opts.summaryLevel] short | medium | detailed
 * @param {number} [opts.tabCount] number of pages
 * @param {object} [opts.ctx] context for provider selection
 * @returns {Promise<string>} the summary text
 */
export async function summarize(contents, opts = {}) {
  const { language = 'English', summaryLevel = 'short', tabCount = 1, ctx = {} } = opts;

  const provider = await selectProvider(language, ctx);
  if (!provider) {
    const langNote = language !== 'English'
      ? ` (${language} is not supported by the built-in AI, and you're not signed in to ChatGPT)`
      : ' (no provider is available)';
    throw new Error(`No summarization provider available${langNote}`);
  }

  return provider.impl.summarize(contents, { language, summaryLevel, tabCount });
}

/**
 * Exported for testing: allows injecting mock providers in place.
 */
export { PROVIDERS };

/**
 * Raw built-in-model availability, for UI that needs to distinguish
 * "ready now" from "will download on first use". Returns one of
 * 'unavailable' | 'downloadable' | 'downloading' | 'available'.
 * Never throws.
 * @returns {Promise<'unavailable'|'downloadable'|'downloading'|'available'>}
 */
export async function builtinAvailability() {
  return chromeBuiltin.availability();
}
