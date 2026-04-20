/**
 * DOM element binding helper.
 * Builds a consistent DOM reference map from element IDs.
 * Used by both popup.js and sidebar.js to avoid duplication.
 */

const DOM_IDS = [
  'mode-toggle', 'auth-icon', 'auth-text', 'connect-btn', 'disconnect-btn',
  'source-select', 'group-section', 'group-select', 'no-groups',
  'readinglist-section', 'readinglist-list', 'no-readinglist',
  'pages-section', 'pages-list',
  'select-all-btn', 'deselect-all-btn',
  'rl-select-all-btn', 'rl-deselect-all-btn',
  'summary-level-select', 'language-select', 'summarize-btn',
  'debug-console', 'debug-section', 'debug-toggle', 'clear-debug-btn',
  'loading-section', 'loading-text', 'progress-fill', 'progress-text',
  'summary-section', 'summary-content', 'copy-summary-btn',
  'error-section', 'error-message'
];

/**
 * Builds a DOM reference map from the document.
 * @returns {Object} Map of camelCase keys to DOM elements
 */
export function buildDomBindings() {
  const dom = {};
  for (const id of DOM_IDS) {
    const key = id.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    dom[key] = document.getElementById(id);
  }
  return dom;
}
