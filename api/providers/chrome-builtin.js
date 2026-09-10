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

// Conservative character cap used when the Summarizer API doesn't expose
// inputQuota / measureInputUsage (older Chrome builds or test mocks). Keeps
// behavior defined even without the introspection APIs.
const FALLBACK_MAX_CHARS = 4000;

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
 * @param {(kind:'loading'|'downloading')=>void} [opts.onModelLoading]
 *        Fires once, right before the model is created, so the UI can show
 *        activity even on warm runs. `kind` is 'downloading' when a genuine
 *        model download is pending (availability 'downloadable'/'downloading'),
 *        or 'loading' when the model is already cached ('available') and only
 *        needs to be spun up in memory.
 * @param {(p:{phase:string,current:number,total:number})=>void} [opts.onProgress]
 *        Chunking progress. `phase` is 'summarizing' (per-chunk map pass) or
 *        'combining' (reduce pass). `current`/`total` are 1-based part indices
 *        for the current pass. Only fires when the input is large enough to be
 *        split; single-shot summaries don't emit progress.
 * @param {AbortSignal|null} [opts.signal] abort signal
 * @returns {Promise<string>} the summary text
 */
export async function summarize(text, opts = {}) {
  const {
    language = 'English',
    summaryLevel = 'short',
    tabCount = 1,
    onDownloadProgress = null,
    onModelLoading = null,
    onProgress = null,
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

  // Probe availability once so we can (a) tell the UI what's happening before
  // create() and (b) only relay download progress when a download is real.
  // Chrome fires `downloadprogress` events (0 -> 1) on every create() — even
  // for an already-cached model, where no bytes move and no network is used.
  // Relaying those flashes a misleading "Downloading 0% -> 100%" on every warm
  // run. A cached model reports 'available'; a genuine first-time/renewed
  // download reports 'downloadable'/'downloading'. Per the spec, subsequent
  // use of a downloaded model needs no network.
  // https://developer.chrome.com/docs/ai/summarizer-api ("Model download")
  const needsProgress = typeof onDownloadProgress === 'function';
  const needsLoadingSignal = typeof onModelLoading === 'function';
  if (needsProgress || needsLoadingSignal) {
    const status = await availability();
    const isDownloading = status === 'downloadable' || status === 'downloading';
    if (needsLoadingSignal) {
      try { onModelLoading(isDownloading ? 'downloading' : 'loading'); }
      catch { /* ignore listener errors */ }
    }
    if (needsProgress && isDownloading) {
      createOptions.monitor = (m) => {
        m.addEventListener('downloadprogress', (e) => {
          try { onDownloadProgress(e.loaded); } catch { /* ignore listener errors */ }
        });
      };
    }
  }
  if (signal) createOptions.signal = signal;

  const summarizer = await globalThis.Summarizer.create(createOptions);
  try {
    const summarizeOptions = {};
    if (signal) summarizeOptions.signal = signal;
    if (typeof onProgress === 'function') summarizeOptions.onProgress = onProgress;
    // The on-device model has a small context window; oversized input makes
    // summarize() throw "The input is too large.". When the text fits, we
    // summarize it directly. When it doesn't, we chunk-and-reduce: split into
    // quota-sized chunks, summarize each, then summarize the concatenated
    // partial summaries — recursing until the result fits. This covers the
    // whole page instead of dropping its tail.
    // See https://developer.chrome.com/docs/ai/scale-summarization
    return await summarizeWithinQuota(summarizer, text, summarizeOptions);
  } finally {
    // Free the on-device session promptly.
    try { summarizer.destroy(); } catch { /* best effort */ }
  }
}

/**
 * Summarizes `text` while respecting the model's input quota, using
 * chunk-and-reduce for input that's too large to summarize in one call.
 *
 * Strategy:
 *   1. If the whole text fits the quota, summarize it in one shot.
 *   2. Otherwise split into the fewest quota-sized chunks, summarize each,
 *      join the partial summaries, and recurse on that (usually much shorter)
 *      combined text. Recursion terminates because each reduce pass shrinks
 *      the input, and a single un-splittable chunk is hard-clipped to fit.
 *
 * @param {object} summarizer created Summarizer session (reused for all calls)
 * @param {string} text
 * @param {object} summarizeOptions passed through to summarizer.summarize()
 * @param {number} [depth] recursion guard
 * @returns {Promise<string>}
 */
async function summarizeWithinQuota(summarizer, text, summarizeOptions, depth = 0) {
  // Hard stop on pathological inputs: after this many reduce passes, force the
  // text to a single fitted chunk and summarize whatever remains.
  const MAX_DEPTH = 5;

  // `onProgress` is our own key — keep it out of the options handed to the
  // model's summarize() call.
  const { onProgress, ...modelOptions } = summarizeOptions;

  if (await fitsQuota(summarizer, text)) {
    return await summarizer.summarize(text, modelOptions);
  }

  if (depth >= MAX_DEPTH) {
    // Give up on covering everything; summarize a single fitted slice so we
    // still return a result rather than throwing "input too large".
    const clipped = await fitToInputQuota(summarizer, text);
    return await summarizer.summarize(clipped, modelOptions);
  }

  // Map: split into fitting chunks and summarize each.
  const chunks = await splitIntoQuotaChunks(summarizer, text);
  const partials = [];
  for (let i = 0; i < chunks.length; i++) {
    // Abort promptly if the caller cancelled mid-way.
    if (modelOptions.signal?.aborted) {
      throw new DOMException('Summarization aborted', 'AbortError');
    }
    // Report per-chunk progress for this map pass. On the first (depth 0) pass
    // this is the "part N of M" the user sees; deeper passes are reduce steps
    // over already-shortened text and are reported as 'combining'.
    if (typeof onProgress === 'function') {
      try {
        onProgress({
          phase: depth === 0 ? 'summarizing' : 'combining',
          current: i + 1,
          total: chunks.length
        });
      } catch { /* ignore listener errors */ }
    }
    partials.push(await summarizer.summarize(chunks[i], modelOptions));
  }

  // Reduce: summarize the concatenated partial summaries. Recurse in case the
  // combined partials are themselves still over quota.
  const combined = partials.join('\n\n');
  return await summarizeWithinQuota(summarizer, combined, summarizeOptions, depth + 1);
}

/**
 * True if `text` fits within the summarizer's input quota. When the API can't
 * report usage (older Chrome / mocks), falls back to a conservative char cap
 * so behavior stays defined.
 */
async function fitsQuota(summarizer, text) {
  const quota = typeof summarizer.inputQuota === 'number' ? summarizer.inputQuota : null;
  const canMeasure = typeof summarizer.measureInputUsage === 'function';
  if (quota == null || !canMeasure) {
    return text.length <= FALLBACK_MAX_CHARS;
  }
  try {
    const usage = await summarizer.measureInputUsage(text);
    if (typeof usage !== 'number') return text.length <= FALLBACK_MAX_CHARS;
    return usage <= quota;
  } catch {
    return text.length <= FALLBACK_MAX_CHARS;
  }
}

/**
 * Splits `text` into the fewest consecutive chunks that each fit the quota.
 *
 * Cuts prefer paragraph, then line, then word boundaries so each chunk is
 * coherent. A single boundary-less run longer than the quota is hard-clipped
 * (via fitToInputQuota) so the splitter always makes forward progress.
 *
 * @returns {Promise<string[]>} at least one chunk, each fitting the quota
 */
async function splitIntoQuotaChunks(summarizer, text) {
  const chunks = [];
  let rest = text;

  while (rest.length > 0) {
    if (await fitsQuota(summarizer, rest)) {
      chunks.push(rest);
      break;
    }
    // Find the largest prefix of `rest` that fits the quota. fitToInputQuota
    // already measures + trims to the model's real budget on a boundary.
    let head = await fitToInputQuota(summarizer, rest);
    if (head.length === 0) {
      // Quota is absurdly small or measurement misbehaved; take one char so we
      // never loop forever.
      head = rest.slice(0, 1);
    }
    chunks.push(head);
    rest = rest.slice(head.length);
    // Trim leading whitespace left at the cut so the next chunk starts clean.
    rest = rest.replace(/^\s+/, '');
  }

  return chunks.length > 0 ? chunks : [text];
}

/**
 * Trims `text` so it fits within the summarizer's input quota.
 *
 * Uses the API's own `inputQuota` + `measureInputUsage()` when available
 * (https://developer.chrome.com/docs/ai/scale-summarization). Tokens aren't
 * proportional to characters, so we measure, estimate a shorter cut by the
 * over-budget ratio, and re-measure — looping a few times to converge. Every
 * cut ends on a whitespace boundary when possible to avoid splitting a word.
 *
 * If the API doesn't expose quota introspection (older Chrome, or our test
 * mocks), we fall back to a conservative character cap.
 *
 * @param {object} summarizer a created Summarizer session
 * @param {string} text
 * @returns {Promise<string>} text guaranteed to fit (best effort)
 */
async function fitToInputQuota(summarizer, text) {
  const quota = typeof summarizer.inputQuota === 'number' ? summarizer.inputQuota : null;
  const canMeasure = typeof summarizer.measureInputUsage === 'function';

  if (quota == null || !canMeasure) {
    return text.length > FALLBACK_MAX_CHARS ? clipAtBoundary(text, FALLBACK_MAX_CHARS) : text;
  }

  let candidate = text;
  // A few iterations converge quickly: each pass cuts by the measured overage.
  for (let i = 0; i < 5; i++) {
    let usage;
    try {
      usage = await summarizer.measureInputUsage(candidate);
    } catch {
      // If measurement fails, fall back to the char cap and stop.
      return candidate.length > FALLBACK_MAX_CHARS ? clipAtBoundary(candidate, FALLBACK_MAX_CHARS) : candidate;
    }
    if (typeof usage !== 'number' || usage <= quota) return candidate;
    // Estimate a shorter length proportional to how far over quota we are,
    // with a 10% safety margin so we don't hover right at the limit.
    const ratio = (quota / usage) * 0.9;
    const nextLen = Math.max(1, Math.floor(candidate.length * ratio));
    if (nextLen >= candidate.length) {
      // Ratio didn't shrink it (shouldn't happen) — force a hard cut.
      candidate = clipAtBoundary(candidate, Math.floor(candidate.length / 2));
    } else {
      candidate = clipAtBoundary(candidate, nextLen);
    }
  }
  return candidate;
}

/**
 * Cuts `text` to at most `maxChars`, preferring the last whitespace boundary
 * within the final 10% so we don't slice a word in half.
 */
function clipAtBoundary(text, maxChars) {
  if (text.length <= maxChars) return text;
  const hard = text.slice(0, maxChars);
  const lastWs = hard.lastIndexOf(' ');
  if (lastWs > maxChars * 0.9) return hard.slice(0, lastWs);
  return hard;
}

export { SUPPORTED_LANGUAGES };
