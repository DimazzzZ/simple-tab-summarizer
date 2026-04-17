/**
 * Reading list feature module.
 * Handles loading, rendering, and managing reading list entries.
 */

/**
 * Loads reading list entries.
 * @param {Object} dom - DOM references
 * @param {Function} debugLog - Logger function
 * @param {Function} showError - Error display function
 * @returns {Promise<Object[]>} Array of reading list entries
 */
export async function loadReadingList(dom, debugLog, showError) {
  try {
    debugLog('Loading reading list...');
    if (!chrome.readingList) {
      debugLog('Reading List API not available', 'error');
      showError('Reading List is not available in this browser.');
      dom.readinglistSection.classList.add('hidden');
      return [];
    }

    const entries = await chrome.readingList.query({});
    debugLog(`Found ${entries.length} reading list entries`);

    if (entries.length === 0) {
      dom.readinglistList.innerHTML = '';
      dom.noReadinglist.classList.remove('hidden');
      dom.readinglistSection.classList.remove('hidden');
      return [];
    }

    dom.noReadinglist.classList.add('hidden');
    dom.readinglistSection.classList.remove('hidden');
    return entries;
  } catch (error) {
    debugLog(`Error loading reading list: ${error.message}`, 'error');
    showError('Failed to load reading list.');
    return [];
  }
}

/**
 * Removes an entry from the reading list.
 * @param {string} url - The URL to remove
 * @param {Function} debugLog - Logger function
 * @returns {Promise<boolean>} Whether removal succeeded
 */
export async function removeReadingListEntry(url, debugLog) {
  try {
    await chrome.readingList.removeEntry({ url });
    debugLog(`Removed reading list entry: ${url}`);
    return true;
  } catch (err) {
    debugLog(`Failed to remove reading list entry: ${err.message}`, 'error');
    return false;
  }
}

/**
 * Refreshes reading list entries while preserving selection by URL.
 * @param {Set<string>} selectedUrls - URLs to preserve selection for
 * @param {Function} debugLog - Logger function
 * @returns {Promise<{entries: Object[], selectedIds: Set<number>}>}
 */
export async function refreshReadingList(selectedUrls, debugLog) {
  if (!chrome.readingList) return { entries: [], selectedIds: new Set() };

  try {
    const entries = await chrome.readingList.query({});
    const selectedIds = new Set();

    entries.forEach((entry, index) => {
      if (selectedUrls.has(entry.url)) {
        selectedIds.add(index);
      }
    });

    debugLog(`Refreshed reading list: ${entries.length} entries`);
    return { entries, selectedIds };
  } catch (error) {
    debugLog(`Error refreshing reading list: ${error.message}`, 'error');
    return { entries: [], selectedIds: new Set() };
  }
}
