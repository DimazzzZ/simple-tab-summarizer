/**
 * Storage synchronization module.
 * Handles shared context and session state persistence across popup/sidebar.
 */

import { SHARED_CONTEXT_KEY, SHARED_SESSION_KEY } from '../constants/ui-keys.js';

/**
 * Loads shared context and session from chrome.storage.local.
 * @returns {Promise<{context: Object|null, session: Object|null}>}
 */
export async function loadState() {
  try {
    const result = await chrome.storage.local.get([SHARED_CONTEXT_KEY, SHARED_SESSION_KEY]);
    return {
      context: result[SHARED_CONTEXT_KEY] || null,
      session: result[SHARED_SESSION_KEY] || null
    };
  } catch {
    return { context: null, session: null };
  }
}

/**
 * Saves shared context to chrome.storage.local.
 * @param {Object} ctx - Context to save
 * @param {string} instanceId - Current UI instance ID (for loop prevention)
 */
export async function saveContext(ctx, instanceId) {
  try {
    const data = {
      ...ctx,
      updatedAt: Date.now(),
      updatedBy: instanceId
    };
    await chrome.storage.local.set({ [SHARED_CONTEXT_KEY]: data });
  } catch (e) {
    console.error(`Failed to save shared context: ${e.message}`);
  }
}

/**
 * Saves session state (summary/error) to chrome.storage.local.
 * @param {Object} ui - UI DOM references
 * @param {string} instanceId - Current UI instance ID
 */
export async function saveSession(ui, instanceId) {
  try {
    const session = {
      summaryText: ui.summaryContent?.textContent || null,
      errorMessage: ui.errorMessage?.textContent || null,
      updatedAt: Date.now(),
      updatedBy: instanceId
    };
    await chrome.storage.local.set({ [SHARED_SESSION_KEY]: session });
  } catch (e) {
    console.error(`Failed to save session state: ${e.message}`);
  }
}

/**
 * Subscribes to storage changes for shared context sync.
 * @param {Function} onContextChange - Callback when context changes
 * @param {string} instanceId - Current UI instance ID (to ignore own updates)
 * @returns {Function} Unsubscribe function
 */
export function subscribe(onContextChange, instanceId) {
  const listener = (changes, area) => {
    if (area === 'local' && changes[SHARED_CONTEXT_KEY]) {
      const ctx = changes[SHARED_CONTEXT_KEY].newValue;
      if (ctx && ctx.updatedBy !== instanceId) {
        onContextChange(ctx);
      }
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
