/**
 * Chrome built-in AI provider (Gemini Nano, on-device).
 *
 * Wraps Chrome's Summarizer API — https://developer.chrome.com/docs/ai/summarizer-api
 * The API surface is the `Summarizer` global (not a `chrome.*` namespace) and is
 * ONLY available in a document context (popup/sidebar page), NOT in the
 * service worker / Web Worker. So this module is imported and run from the UI
 * layer (features/summarize.js), never from background.js.
 *
 * Zero-auth: runs fully on-device, no sign-in, no network (after the one-time
 * model download). Available on Chrome 138+ when hardware requirements are met.
 *
 * Language support is limited to what the built-in model exposes as
 * `outputLanguage`: English, Japanese, Spanish, German, French. Requests for
 * other languages are routed elsewhere by the provider registry
 * (see api/providers/index.js).
 */

export const PROVIDER_NAME = 'chrome-builtin';

// Languages the built-in Summarizer can emit. Keys are the human-readable
// values used by the language <select>; values are the BCP-47 codes the API
// expects for `outputLanguage`.
const SUPPORTED_LANGUAGES = {
  English: 'en',
  Japanese: 'ja',
  Spanish: 'es',
  German: 'de',
  French: 'fr'
};

// Maps our short/medium/detailed levels onto the Summarizer `length` option.
const LEVEL_TO_LENGTH = {
  short: 'short',
  medium: 'medium',
  detailed: 'long'
};

/**
 * Pure. True if `language` can be produced by the built-in model.
 * @param {string} language human-readable language name (e.g. "English")
 */
export function supportsLanguage(language) {
  return Object.prototype.hasOwnProperty.call(SUPPORTED_LANGUAGES, language);
}

/**
 * Detects whether the Summarizer API object exists in this context.
 * Cheap synchronous check — does NOT touch model availability or hardware.
 */
export function hasSummarizerApi() {
  return typeof globalThis.Summarizer !== 'undefined';
}

/**
 * Reports whether the built-in summarizer can actually be used right now.
 *
 * Returns one of:
 *   'unavailable'   — API missing or model can never run on this device
 *   'downloadable'  — usable, but the model must download first (needs user
 *                     activation to trigger)
 *   'downloading'   — model is currently downloading
 *   'available'     — ready to use immediately
 *
 * Never throws; on any error returns 'unavailable'.
 */
export async function availability() {
  if (!hasSummarizerApi()) return 'unavailable';
  try {
    const status = await globalThis.Summarizer.availability();
    if (status === 'available' || status === 'downloadable' ||
        status === 'downloading' || status === 'unavailable') {
      return status;
    }
    return 'unavailable';
  } catch {
    return 'unavailable';
  }
}

/**
 * True if the provider is usable for `language` at all — i.e. the API exists,
 * the model is available or can be downloaded, and the language is supported.
 *
 * @param {string} [language] human-readable language name; defaults to English
 */
export async function isAvailable(language = 'English') {
  if (!supportsLanguage(language)) return false;
  const status = await availability();
  return status === 'available' || status === 'downloadable' || status === 'downloading';
}

/**
 * Runs a summarization fully on-device.
 *
 * @param {string} text                 the combined page contents to summarize
 * @param {object} [opts]
 * @param {string} [opts.language]       human-readable output language
 * @param {string} [opts.summaryLevel]   short | medium | detailed
 * @param {number} [opts.tabCount]       number of pages (affects summary type)
 * @param {(loaded:number)=>void} [opts.onDownloadProgress] 0..1 progress
 * @param {AbortSignal|null} [opts.signal] abort signal
 * @returns {Promise<string>} the summary text
 */
export async function summarize(text, opts = {}) {
  const {
    language = 'English',
    summaryLevel = 'short',
    tabCount = 1,
    onDownloadProgress = null,
    signal = null
  } = opts;

  if (!hasSummarizerApi()) {
    throw new Error('Chrome built-in AI (Summarizer) is not available in this browser.');
  }
  if (!supportsLanguage(language)) {
    throw new Error(`Chrome built-in AI does not support ${language}.`);
  }

  const outputLanguage = SUPPORTED_LANGUAGES[language];
  const length = LEVEL_TO_LENGTH[summaryLevel] || 'short';

  const createOptions = {
    // 'tldr' gives prose-style summaries closest to the ChatGPT path's
    // "concise paragraph" output, rather than a bulleted key-points list.
    type: 'tldr',
    format: 'plain-text',
    length,
    outputLanguage,
    expectedInputLanguages: ['en'],
    sharedContext:
      'The text is raw content extracted from one or more web pages. It may ' +
      'contain navigation, headers, footers, ads, and other boilerplate. ' +
      'Summarize only the main content and ignore UI chrome.'
  };

  if (typeof onDownloadProgress === 'function') {
    createOptions.monitor = (m) => {
      m.addEventListener('downloadprogress', (e) => {
        try { onDownloadProgress(e.loaded); } catch { /* ignore listener errors */ }
      });
    };
  }
  if (signal) createOptions.signal = signal;

  const summarizer = await globalThis.Summarizer.create(createOptions);
  try {
    const summarizeOptions = {};
    if (signal) summarizeOptions.signal = signal;
    const result = await summarizer.summarize(text, summarizeOptions);
    return result;
  } finally {
    // Free the on-device session promptly.
    try { summarizer.destroy(); } catch { /* best effort */ }
  }
}

export { SUPPORTED_LANGUAGES };
