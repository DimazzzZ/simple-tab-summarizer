/**
 * Shared constants for UI state management.
 */

export const SHARED_CONTEXT_KEY = 'shared_ui_context';
export const SHARED_SESSION_KEY = 'shared_ui_session';

export const SourceType = Object.freeze({
  CURRENT_TAB: 'currentTab',
  TAB_GROUP: 'tabGroup',
  READING_LIST: 'readingList'
});

export const Timings = Object.freeze({
  DEBOUNCE_CONTEXT_SAVE_MS: 150,
  DEBOUNCE_SESSION_SAVE_MS: 100,
  DEBOUNCE_REFRESH_MS: 200,
  SCRIPT_TIMEOUT_MS: 8000,
  TAB_READY_TIMEOUT_MS: 30000,
  READING_LIST_READY_TIMEOUT_MS: 15000,
  CLIPBOARD_RESET_MS: 2000,
  MAX_CHARS_PER_TAB: 8000
});
