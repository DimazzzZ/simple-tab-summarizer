/**
 * UI feedback module.
 * Handles loading, progress, error, and summary display states.
 */

/**
 * Shows the loading state.
 * @param {Object} dom - DOM references
 * @param {string} [text] - Loading text to display
 */
export function showLoading(dom, text = 'Extracting content from tabs...') {
  dom.loadingSection.classList.remove('hidden');
  dom.progressFill.style.width = '0%';
  dom.progressText.textContent = '0 / 0 tabs processed';
  dom.loadingText.textContent = text;
}

/**
 * Hides the loading state.
 * @param {Object} dom - DOM references
 */
export function hideLoading(dom) {
  dom.loadingSection.classList.add('hidden');
}

/**
 * Updates the progress bar.
 * @param {Object} dom - DOM references
 * @param {number} current - Current progress count
 * @param {number} total - Total items
 */
export function updateProgress(dom, current, total) {
  const percentage = (current / total) * 100;
  dom.progressFill.style.width = `${percentage}%`;
  dom.progressText.textContent = `${current} / ${total} tabs processed`;
}

/**
 * Shows a summary message.
 * @param {Object} dom - DOM references
 * @param {string} text - Summary text
 */
export function showSummary(dom, text) {
  dom.summaryContent.textContent = text;
  dom.summarySection.classList.remove('hidden');
}

/**
 * Hides the summary section.
 * @param {Object} dom - DOM references
 */
export function hideSummary(dom) {
  dom.summarySection.classList.add('hidden');
}

/**
 * Shows an error message.
 * @param {Object} dom - DOM references
 * @param {string} message - Error message
 */
export function showError(dom, message) {
  dom.errorMessage.textContent = message;
  dom.errorSection.classList.remove('hidden');
}

/**
 * Hides the error section.
 * @param {Object} dom - DOM references
 */
export function hideError(dom) {
  dom.errorSection.classList.add('hidden');
}
