/**
 * Summarization feature module.
 * Orchestrates the summarization flow.
 */

import { extractTabContents, extractReadingListContents } from './extraction.js';
import { showLoading, hideLoading, updateProgress, showSummary, showError, hideError, hideSummary } from '../render/ui-feedback.js';

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

  if (!isAuthenticated) {
    showError(dom, 'Please connect to ChatGPT first.');
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
    debugLog('Sending request to ChatGPT API...');

    const summary = await chrome.runtime.sendMessage({
      action: 'summarize',
      contents,
      tabCount: contents.length,
      language: summaryLanguage,
      summaryLevel
    });

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
