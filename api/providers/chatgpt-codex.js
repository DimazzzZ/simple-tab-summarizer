/**
 * ChatGPT/Codex provider.
 *
 * A thin adapter over the existing api/codex-client.js. The actual HTTP call
 * and OAuth-token handling stay in background.js (the service worker), because
 * only the SW has access to the stored ChatGPT credentials. This UI-side
 * adapter therefore just forwards the request to the background via
 * chrome.runtime.sendMessage — the same `summarize` action background.js has
 * been handling all along.
 *
 * Keeping the ChatGPT logic un-duplicated (rather than inlining ~300 lines of
 * SSE parsing here) means the existing unit tests for codex-client.js remain
 * the single source of truth for that behavior.
 */

export const PROVIDER_NAME = 'chatgpt-codex';

/**
 * True if the user is authenticated with ChatGPT. Uses the existing
 * `check_auth` message the background worker already implements.
 */
export async function isAvailable(_language, ctx = {}) {
  // Callers may pass a pre-resolved auth flag to save a round-trip.
  if (typeof ctx.isAuthenticated === 'boolean') return ctx.isAuthenticated;
  try {
    const response = await chrome.runtime.sendMessage({ action: 'check_auth' });
    return !!(response && response.authenticated);
  } catch {
    return false;
  }
}

/**
 * Runs a summarization by delegating to background.js (which owns the OAuth
 * token and the network call). Returns the summary text, or throws on error.
 *
 * @param {Array<{title:string,url:string,content:string}>|string} contents
 *        Either the pre-serialized user message (as a string) OR the raw
 *        per-page objects. Passing the objects is preferred because
 *        background.js already handles per-tab clipping identically to the
 *        pre-refactor call site — this preserves parity.
 * @param {object} [opts]
 * @param {string} [opts.language]      output language
 * @param {string} [opts.summaryLevel]  short | medium | detailed
 * @param {number} [opts.tabCount]      number of pages
 * @returns {Promise<string>} the summary text
 */
export async function summarize(contents, opts = {}) {
  const {
    language = 'English',
    summaryLevel = 'short',
    tabCount = Array.isArray(contents) ? contents.length : 1
  } = opts;

  // background.js expects `contents` as an array of {title,url,content}.
  // If we were handed a bare string, wrap it as a single "page".
  const contentsArr = Array.isArray(contents)
    ? contents
    : [{ title: '', url: '', content: String(contents) }];

  const response = await chrome.runtime.sendMessage({
    action: 'summarize',
    contents: contentsArr,
    tabCount,
    language,
    summaryLevel
  });

  if (!response) {
    throw new Error('No response from background worker.');
  }
  if (response.error) {
    throw new Error(response.error);
  }
  return response.text;
}
