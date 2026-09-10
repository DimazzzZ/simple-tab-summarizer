/**
 * Summarization feature module.
 * Orchestrates the summarization flow.
 */

import { extractTabContents, extractReadingListContents } from './extraction.js';
import { showLoading, hideLoading, updateProgress, showSummary, showError, hideError, hideSummary } from '../render/ui-feedback.js';
import { selectProvider } from '../api/providers/index.js';

/**
 * Decides what download text (if any) to show for a `downloadprogress` event.
 *
 * Chrome fires a `downloadprogress` event even when the model is already
 * cached — typically a single event with `loaded === 1` and no prior partial
 * progress. Rendering that as "Downloading 100%" flashes a misleading message
 * on every warm run. We only surface download text once we've actually
 * observed an in-progress event (`loaded < 1`); a standalone 100% is ignored.
 *
 * Pure and side-effect free so it can be unit-tested. `state` is a small
 * mutable object the caller threads across events for one summarize run.
 *
 * @param {number} loaded 0..1 fraction from the downloadprogress event
 * @param {{sawRealDownload:boolean}} state per-run flag, mutated in place
 * @returns {string|null} loading text to display, or null to leave it unchanged
 */
export function downloadProgressText(loaded, state) {
  if (loaded < 1) state.sawRealDownload = true;
  if (!state.sawRealDownload) return null;
  return `Downloading on-device model: ${Math.round(loaded * 100)}%`;
}

/**
 * Handles the full summarization flow.
 * @param {Object} ctx - Context object with all dependencies
 * @param {string} ctx.source - Current source type
 * @param {Object} ctx.dom - DOM references
 * @param {Object[]} ctx.groupTabs - Array of tab objects
 * @param {Set<number>} ctx.selectedTabIds - Selected tab IDs
 * @param {Object[]} ctx.readingListEntries - Reading list entries
 * @param {Set<number>} ctx.selectedReadingListIds - Selected reading list indices
 * @param {boolean} ctx.isAuthenticated - Whether user is authenticated
 * @param {Array<string>} [ctx.availableProviders] - List of available provider names
 * @param {string} [ctx.providerPreference] - User's provider choice
 *        ('auto' | 'chrome-builtin' | 'chatgpt-codex'). Defaults to 'auto'.
 * @param {Function} ctx.debugLog - Logger function
 * @param {Function} ctx.updateButtonsState - Button state updater
 * @returns {Promise<void>}
 */
export async function handleSummarize(ctx) {
  const { source, dom, groupTabs, selectedTabIds, readingListEntries, selectedReadingListIds, isAuthenticated, providerPreference = 'auto', debugLog, updateButtonsState } = ctx;

  let itemCount = 0;
  if (source === 'currentTab') itemCount = 1;
  else if (source === 'tabGroup') itemCount = selectedTabIds.size;
  else if (source === 'readingList') itemCount = selectedReadingListIds.size;

  if (itemCount === 0) {
    showError(dom, 'No items selected.');
    return;
  }

  const summaryLanguage = dom.languageSelect.value || 'English';
  const summaryLevel = dom.summaryLevelSelect?.value || 'short';
  debugLog(`Starting summarization for ${itemCount} ${source} items in ${summaryLanguage} (${summaryLevel})`);

  showLoading(dom);
  hideError(dom);
  hideSummary(dom);
  dom.summarizeBtn.disabled = true;

  try {
    // Pick the best provider for this language / auth state before doing any work.
    const provider = await selectProvider(summaryLanguage, { isAuthenticated, preference: providerPreference });
    if (!provider) {
      if (summaryLanguage !== 'English') {
        showError(dom, `${summaryLanguage} is only supported via ChatGPT. Please sign in to continue.`);
      } else {
        showError(dom, 'No summarization provider available. Use Chrome 138+ for built-in AI, or sign in to ChatGPT.');
      }
      debugLog(`No provider available for ${summaryLanguage}`, 'warn');
      return;
    }
    debugLog(`Using provider: ${provider.name} (preference: ${providerPreference})`);

    let contents = [];
    if (source === 'currentTab') {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!activeTab) {
        showError(dom, 'No active tab found.');
        return;
      }
      debugLog(`Summarizing current tab: ${activeTab.title || 'Untitled'}`);
      contents = await extractTabContents([activeTab], debugLog,
        (c, t) => updateProgress(dom, c, t),
        (text) => { dom.loadingText.textContent = text; }
      );
    } else if (source === 'tabGroup') {
      const selectedTabs = groupTabs.filter(t => selectedTabIds.has(t.id));
      contents = await extractTabContents(selectedTabs, debugLog,
        (c, t) => updateProgress(dom, c, t),
        (text) => { dom.loadingText.textContent = text; }
      );
    } else if (source === 'readingList') {
      const selectedEntries = readingListEntries.filter((_, i) => selectedReadingListIds.has(i));
      contents = await extractReadingListContents(selectedEntries, debugLog,
        (c, t) => updateProgress(dom, c, t),
        (text) => { dom.loadingText.textContent = text; }
      );
    }

    debugLog(`Extracted content from ${contents.length} items`);

    dom.loadingText.textContent = 'Sending to AI for summarization...';
    debugLog('Sending request to AI...');

    let summary;
    if (provider.name === 'chrome-builtin') {
      // Run the built-in summarizer directly in this document context.
      const userMessage = buildUserMessage(contents);
      const truncatedMessage = truncateMessage(userMessage, 100000);
      try {
        // Initial text before we know model state. onModelLoading (below) fires
        // right away with the real state and overwrites this.
        dom.loadingText.textContent = 'Loading on-device model...';
        // See downloadProgressText: suppresses the misleading "Downloading
        // 100%" flash on warm (already-cached) runs.
        const downloadState = { sawRealDownload: false };
        const text = await provider.impl.summarize(truncatedMessage, {
          language: summaryLanguage,
          summaryLevel,
          tabCount: contents.length,
          onModelLoading: (kind) => {
            // 'downloading' -> a real model download is pending (first use or
            // after eviction). 'loading' -> model is cached; we only wait for
            // it to spin up in memory, so tell the user something's happening.
            dom.loadingText.textContent = kind === 'downloading'
              ? 'Downloading on-device model...'
              : 'Loading on-device model...';
          },
          onDownloadProgress: (loaded) => {
            const msg = downloadProgressText(loaded, downloadState);
            if (msg !== null) dom.loadingText.textContent = msg;
          },
          onProgress: ({ phase, current, total }) => {
            // Long pages get split into quota-sized chunks. Show which one
            // we're on so the loader doesn't look frozen.
            if (phase === 'summarizing') {
              dom.loadingText.textContent = `Summarizing part ${current} of ${total}...`;
            } else {
              // Reduce pass: combining partial summaries into a final one.
              dom.loadingText.textContent = `Combining summaries (${current} of ${total})...`;
            }
          }
        });
        summary = { text, error: null };
      } catch (error) {
        summary = { text: null, error: `Built-in AI failed: ${error.message}` };
      }
    } else {
      // ChatGPT: delegate to the background worker (it owns the OAuth token).
      summary = await chrome.runtime.sendMessage({
        action: 'summarize',
        contents,
        tabCount: contents.length,
        language: summaryLanguage,
        summaryLevel
      });
    }

    if (summary.error) {
      debugLog(`Summarization error: ${summary.error}`, 'error');
      showError(dom, summary.error);
    } else {
      debugLog('Successfully received summary from AI');
      showSummary(dom, summary.text);
    }
  } catch (error) {
    debugLog(`Error during summarization: ${error.message}`, 'error');
    showError(dom, 'Failed to summarize. Please try again.');
  } finally {
    hideLoading(dom);
    updateButtonsState();
  }
}

/**
 * Builds the user message from page contents (parity with background.js).
 * Kept local to avoid importing background.js (a service-worker module) into
 * the UI bundle.
 */
function buildUserMessage(contents) {
  const MAX_CHARS_PER_TAB = 30000;
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

/**
 * Truncates a message to a max length (parity with background.js).
 */
function truncateMessage(message, maxLength) {
  if (message.length <= maxLength) return message;
  return message.substring(0, maxLength) + '\n[content clipped]';
}
