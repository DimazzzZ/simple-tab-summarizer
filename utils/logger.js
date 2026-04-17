/**
 * Simple debug logger for UI controller.
 */

/**
 * Creates a logger instance bound to a DOM debug console.
 * @param {Object} dom - DOM references including debugConsole
 * @param {boolean} enabled - Whether debug logging is enabled
 * @returns {Object} Logger with debugLog method
 */
export function createLogger(dom, enabled = false) {
  /**
   * Logs a message to the debug console and browser console.
   * @param {string} message - The message to log
   * @param {string} [type='info'] - Log type: 'info', 'warn', 'error'
   */
  function debugLog(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const entry = document.createElement('div');
    entry.className = `debug-entry debug-${type}`;
    entry.textContent = `[${timestamp}] ${message}`;
    if (enabled && dom.debugConsole) {
      dom.debugConsole.appendChild(entry);
      dom.debugConsole.scrollTop = dom.debugConsole.scrollHeight;
    }
    console.log(`[TabGroupSummarizer] ${message}`);
  }

  return { debugLog, enabled };
}
