/**
 * Lifecycle listeners module.
 * Manages tab and reading list event listeners with proper cleanup.
 */

import { createDebounce } from '../utils/debounce.js';

/**
 * Sets up tab lifecycle listeners for auto-refreshing the Select Pages list.
 * @param {Object} state - Current UI state
 * @param {Function} onRefresh - Callback to trigger refresh
 * @param {number} [debounceMs] - Debounce delay in ms
 * @returns {Function} Cleanup function to remove all listeners
 */
export function setupTabLifecycleListeners(state, onRefresh, debounceMs = 200) {
  const debouncedRefresh = createDebounce(onRefresh, debounceMs);

  const onTabRemoved = () => {
    if (state.currentSource === 'tabGroup' && state.selectedGroupId !== null) {
      debouncedRefresh();
    }
  };

  const onTabAttached = () => {
    if (state.currentSource === 'tabGroup' && state.selectedGroupId !== null) {
      debouncedRefresh();
    }
  };

  const onTabDetached = () => {
    if (state.currentSource === 'tabGroup' && state.selectedGroupId !== null) {
      debouncedRefresh();
    }
  };

  const onTabUpdated = (tabId, changeInfo) => {
    if (state.currentSource === 'tabGroup' && state.selectedGroupId !== null) {
      if (changeInfo.groupId !== undefined || changeInfo.url || changeInfo.title) {
        debouncedRefresh();
      }
    }
  };

  chrome.tabs.onRemoved.addListener(onTabRemoved);
  chrome.tabs.onAttached.addListener(onTabAttached);
  chrome.tabs.onDetached.addListener(onTabDetached);
  chrome.tabs.onUpdated.addListener(onTabUpdated);

  return () => {
    chrome.tabs.onRemoved.removeListener(onTabRemoved);
    chrome.tabs.onAttached.removeListener(onTabAttached);
    chrome.tabs.onDetached.removeListener(onTabDetached);
    chrome.tabs.onUpdated.removeListener(onTabUpdated);
    debouncedRefresh.cancel();
  };
}

/**
 * Sets up reading list lifecycle listeners for auto-refreshing the Reading List.
 * @param {Object} state - Current UI state
 * @param {Function} onRefresh - Callback to trigger refresh
 * @param {number} [debounceMs] - Debounce delay in ms
 * @returns {Function} Cleanup function to remove all listeners
 */
export function setupReadingListLifecycleListeners(state, onRefresh, debounceMs = 200) {
  if (!chrome.readingList) return () => {};

  const debouncedRefresh = createDebounce(onRefresh, debounceMs);

  const onEntryAdded = () => {
    if (state.currentSource === 'readingList') debouncedRefresh();
  };

  const onEntryRemoved = () => {
    if (state.currentSource === 'readingList') debouncedRefresh();
  };

  const onEntryUpdated = () => {
    if (state.currentSource === 'readingList') debouncedRefresh();
  };

  if (chrome.readingList.onEntryAdded) chrome.readingList.onEntryAdded.addListener(onEntryAdded);
  if (chrome.readingList.onEntryRemoved) chrome.readingList.onEntryRemoved.addListener(onEntryRemoved);
  if (chrome.readingList.onEntryUpdated) chrome.readingList.onEntryUpdated.addListener(onEntryUpdated);

  return () => {
    if (chrome.readingList.onEntryAdded) chrome.readingList.onEntryAdded.removeListener(onEntryAdded);
    if (chrome.readingList.onEntryRemoved) chrome.readingList.onEntryRemoved.removeListener(onEntryRemoved);
    if (chrome.readingList.onEntryUpdated) chrome.readingList.onEntryUpdated.removeListener(onEntryUpdated);
    debouncedRefresh.cancel();
  };
}
