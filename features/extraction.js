import { isRestrictedUrl, executeScriptWithTimeout, waitForTabReady } from '../utils/chrome-helpers.js';
import { Timings } from '../constants/ui-keys.js';

async function extractContentFromTab(tabId) {
  await executeScriptWithTimeout(tabId, ['content.js'], Timings.SCRIPT_TIMEOUT_MS, 'MAIN');

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: async () => {
      if (window.__tabSummarizerExtractAsync) {
        return await window.__tabSummarizerExtractAsync();
      }
      return null;
    }
  });

  return results?.[0]?.result || null;
}

export async function extractTabContents(tabs, debugLog, onProgress, onLoadingText) {
  const contents = new Array(tabs.length);
  const totalTabs = tabs.length;
  const CONCURRENCY = 2;
  let completed = 0;

  const extractSingleTab = async (index, tab) => {
    debugLog(`Extracting tab ${index + 1}/${totalTabs}: ${tab.title || 'Untitled'} (ID: ${tab.id})`);

    let currentTab = tab;

    try {
      if (isRestrictedUrl(tab.url)) {
        debugLog(`Tab ${index + 1} is restricted: ${tab.url}`, 'warn');
        contents[index] = { title: tab.title, url: tab.url, content: '[Restricted page]' };
        return;
      }

      if (tab.status === 'unloaded' || tab.discarded) {
        debugLog(`Tab ${tab.id} is unloaded/discarded, reloading...`);
        await chrome.tabs.reload(tab.id);
        currentTab = await waitForTabReady(tab.id);
        debugLog(`Tab ${tab.id} reloaded, status: ${currentTab.status}`);
      }

      debugLog(`Extracting content from tab ${currentTab.id}...`);
      const content = await extractContentFromTab(currentTab.id);

      if (content) {
        debugLog(`Tab ${index + 1} extracted: ${content.length} characters`);
        contents[index] = { title: currentTab.title, url: currentTab.url, content };
      } else {
        debugLog(`Tab ${index + 1} returned no content`, 'warn');
        contents[index] = { title: currentTab.title, url: currentTab.url, content: '[No content extracted]' };
      }
    } catch (error) {
      debugLog(`Error extracting tab ${index + 1}: ${error.message}`, 'error');
      if (error.message.includes('Cannot access contents')) {
        contents[index] = { title: tab.title, url: tab.url, content: '[Access denied: Chrome blocked this page. Enable "On all sites" in extension Site Access settings.]' };
      } else {
        contents[index] = { title: tab.title, url: tab.url, content: `[Page extraction timed out. Title: ${tab.title || 'N/A'}]` };
      }
    } finally {
      completed++;
      onProgress(completed, totalTabs);
      onLoadingText(`Extracting content from tab ${completed}/${totalTabs}...`);
    }
  };

  for (let i = 0; i < totalTabs; i += CONCURRENCY) {
    const batch = tabs.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map((tab, j) => extractSingleTab(i + j, tab)));
  }

  return contents.filter(c => c !== undefined);
}

export async function extractReadingListContents(selectedEntries, debugLog, onProgress, onLoadingText) {
  const contents = [];
  const totalItems = selectedEntries.length;

  for (let i = 0; i < totalItems; i++) {
    const entry = selectedEntries[i];
    onProgress(i + 1, totalItems);
    onLoadingText(`Extracting content from page ${i + 1}/${totalItems}...`);
    debugLog(`Extracting reading list entry ${i + 1}/${totalItems}: ${entry.title || 'Untitled'} (${entry.url})`);

    try {
      if (isRestrictedUrl(entry.url)) {
        debugLog(`Entry ${i + 1} is restricted: ${entry.url}`, 'warn');
        contents.push({ title: entry.title || 'Untitled', url: entry.url, content: '[Restricted page]' });
        continue;
      }

      debugLog(`Opening ${entry.url} in background tab...`);
      const tempTab = await chrome.tabs.create({ url: entry.url, active: false });

      const readyTab = await waitForTabReady(tempTab.id, Timings.READING_LIST_READY_TIMEOUT_MS);
      debugLog(`Tab ${readyTab.id} ready, status: ${readyTab.status}`);

      debugLog(`Extracting content from tab ${readyTab.id}...`);
      const content = await extractContentFromTab(readyTab.id);

      try { await chrome.tabs.remove(readyTab.id); } catch {}
      debugLog(`Closed temp tab ${readyTab.id}`);

      if (content) {
        contents.push({ title: entry.title || 'Untitled', url: entry.url, content });
      } else {
        debugLog(`Entry ${i + 1} returned no content`, 'warn');
        contents.push({ title: entry.title || 'Untitled', url: entry.url, content: '[No content extracted]' });
      }
    } catch (error) {
      debugLog(`Error extracting entry ${i + 1}: ${error.message}`, 'error');
      let errorMsg = `[Error: ${error.message}]`;
      if (error.message.includes('Cannot access contents')) {
        errorMsg = '[Access denied: Chrome blocked this page.]';
      }
      contents.push({ title: entry.title || 'Untitled', url: entry.url, content: errorMsg });
    }
  }

  return contents;
}