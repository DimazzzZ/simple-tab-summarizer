/**
 * Summarization feature module.
 * Orchestrates the summarization flow.
 */

import { extractTabContents, extractReadingListContents } from './extraction.js';
import { showLoading, hideLoading, updateProgress, showSummary, showError, hideError, hideSummary } from '../render/ui-feedback.js';
import { selectProvider } from '../api/providers/index.js';

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
 * @param {Function} ctx.debugLog - Logger function
 * @param {Function} ctx.updateButtonsState - Button state updater
 * @returns {Promise<void>}
 */
export async function handleSummarize(ctx) {
  const { source, dom, groupTabs, selectedTabIds, readingListEntries, selectedReadingListIds, isAuthenticated, debugLog, updateButtonsState } = ctx;

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
    const provider = await selectProvider(summaryLanguage, { isAuthenticated });
    if (!provider) {
      if (summaryLanguage !== 'English') {
        showError(dom, `${summaryLanguage} is only supported via ChatGPT. Please sign in to continue.`);
      } else {
        showError(dom, 'No summarization provider available. Use Chrome 138+ for built-in AI, or sign in to ChatGPT.');
      }
      debugLog(`No provider available for ${summaryLanguage}`, 'warn');
      return;
    }
    debugLog(`Using provider: ${provider.name}`);

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
        dom.loadingText.textContent = 'Summarizing on-device (may download model on first use)...';
        const text = await provider.impl.summarize(truncatedMessage, {
          language: summaryLanguage,
          summaryLevel,
          tabCount: contents.length,
          onDownloadProgress: (loaded) => {
            dom.loadingText.textContent = `Downloading on-device model: ${Math.round(loaded * 100)}%`;
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
