/**
 * Chrome API helper utilities with timeouts and URL checks.
 */

import { Timings } from '../constants/ui-keys.js';

/**
 * Checks if a URL is restricted/blocked by Chrome extensions.
 * @param {string|null} url - The URL to check
 * @returns {boolean} True if the URL is restricted
 */
export function isRestrictedUrl(url) {
  if (!url) return true;
  const restrictedPrefixes = [
    'chrome://', 'chrome-extension://', 'edge://', 'about:', 'file://', 'devtools://'
  ];
  return restrictedPrefixes.some(prefix => url.startsWith(prefix));
}

/**
 * Executes a script in a tab with a timeout.
 * @param {number} tabId - The tab ID
 * @param {string[]} files - Script files to inject
 * @param {number} [timeoutMs] - Timeout in milliseconds
 * @returns {Promise<any>} Script execution result
 */
export function executeScriptWithTimeout(tabId, files, timeoutMs = Timings.SCRIPT_TIMEOUT_MS) {
  return Promise.race([
    chrome.scripting.executeScript({ target: { tabId }, files }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Script execution timed out after ${timeoutMs}ms`)), timeoutMs)
    )
  ]);
}

/**
 * Waits for a tab to be fully loaded/ready.
 * @param {number} tabId - The tab ID
 * @param {number} [timeout] - Timeout in milliseconds
 * @returns {Promise<Object>} The ready tab object
 */
export function waitForTabReady(tabId, timeout = Timings.TAB_READY_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      chrome.tabs.get(tabId).then(resolve).catch(reject);
    }, timeout);

    function listener(updatedTabId, changeInfo, tab) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(tab);
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}
