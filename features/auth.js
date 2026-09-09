/**
 * Authentication feature module.
 * Handles connect/disconnect logic and auth UI updates.
 */

const AUTH_ICONS = {
  connected: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  disconnected: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>'
};

// Languages the built-in Summarizer can produce. Kept in sync with
// api/providers/chrome-builtin.js SUPPORTED_LANGUAGES. Duplicated here so this
// module stays self-contained and doesn't depend on the provider layer.
const BUILTIN_LANGUAGES = ['English', 'Japanese', 'Spanish', 'German', 'French'];

/**
 * Checks authentication status via background script.
 * @param {Object} dom - DOM references
 * @param {Function} debugLog - Logger function
 * @param {Array<string>} [availableProviders] - List of available provider names
 * @returns {Promise<boolean>} Whether user is authenticated
 */
export async function checkAuthStatus(dom, debugLog, availableProviders = []) {
  try {
    debugLog('Checking auth status...');
    const response = await chrome.runtime.sendMessage({ action: 'check_auth' });
    const authenticated = response.authenticated;
    debugLog(`Auth status: ${authenticated ? 'Connected' : 'Not connected'}`);
    updateAuthUI(dom, authenticated, availableProviders);
    return authenticated;
  } catch (error) {
    debugLog(`Auth check error: ${error.message}`, 'error');
    updateAuthUI(dom, false, availableProviders);
    return false;
  }
}

/**
 * Updates the auth UI elements.
 * @param {Object} dom - DOM references
 * @param {boolean} authenticated - Whether user is authenticated
 * @param {Array<string>} [availableProviders] - List of available provider names
 * @param {string} [language] - Currently selected output language
 * @param {string} [preference] - User's provider choice
 *        ('auto' | 'chrome-builtin' | 'chatgpt-codex')
 */
export function updateAuthUI(dom, authenticated, availableProviders = [], language = 'English', preference = 'auto') {
  const hasBuiltin = availableProviders.includes('chrome-builtin');
  const hasChatgpt = availableProviders.includes('chatgpt-codex');
  // Keep the visible label short (the row is a ~350px flex line with an icon
  // and a button). Detail goes into the title tooltip.
  let label;
  let tooltip = '';
  // When at least one provider is already usable, signing in is OPTIONAL.
  // We render the Connect control as a subtle text link in that case, and
  // as a primary filled button when sign-in is the ONLY way to summarize.
  let connectEmphasis = 'primary'; // 'primary' | 'subtle'
  let connectLabel = 'Sign in';
  if (authenticated) {
    dom.authIcon.classList.remove('disconnected');
    dom.authIcon.classList.add('connected');
    dom.authIcon.innerHTML = AUTH_ICONS.connected;
    label = authStatusText(hasBuiltin, hasChatgpt, preference);
    dom.connectBtn.classList.add('hidden');
    dom.disconnectBtn.classList.remove('hidden');
  } else {
    dom.authIcon.classList.remove('connected');
    dom.authIcon.classList.add('disconnected');
    dom.authIcon.innerHTML = AUTH_ICONS.disconnected;
    if (hasBuiltin) {
      if (preference === 'chatgpt-codex') {
        label = 'Built-in AI ready';
        tooltip = 'Sign in to use ChatGPT; built-in AI is used as a fallback.';
      } else {
        label = 'Built-in AI ready';
        tooltip = 'On-device built-in AI is ready. Sign in for ChatGPT if you prefer.';
      }
      // Built-in AI works — sign-in is optional. De-emphasize the control.
      connectEmphasis = 'subtle';
      connectLabel = 'Sign in to ChatGPT';
    } else if (!BUILTIN_LANGUAGES.includes(language)) {
      // Built-in AI doesn't support this language, and the user isn't signed in.
      label = `Sign in for ${language}`;
      tooltip = `Built-in AI supports only English, Japanese, Spanish, German, French. Sign in to ChatGPT to summarize in ${language}.`;
      connectEmphasis = 'primary';
      connectLabel = 'Sign in';
    } else {
      label = 'Not ready';
      tooltip = 'Sign in to ChatGPT to summarize.';
      connectEmphasis = 'primary';
      connectLabel = 'Sign in';
    }
    dom.connectBtn.classList.remove('hidden');
    dom.disconnectBtn.classList.add('hidden');
    // Apply emphasis + label to the Connect button.
    dom.connectBtn.classList.toggle('btn-subtle', connectEmphasis === 'subtle');
    setConnectBtnText(dom, connectLabel);
  }
  dom.authText.textContent = label;
  dom.authText.title = tooltip || label;
}

/**
 * Builds the auth-row status text for the authenticated case, honoring the
 * user's provider preference so they can see which backend will actually run.
 * @param {boolean} hasBuiltin
 * @param {boolean} hasChatgpt
 * @param {string} preference 'auto' | 'chrome-builtin' | 'chatgpt-codex'
 * @returns {string}
 */
function authStatusText(hasBuiltin, hasChatgpt, preference) {
  if (preference === 'chrome-builtin' && hasBuiltin) return 'Using built-in AI';
  if (preference === 'chatgpt-codex' && hasChatgpt) return 'Using ChatGPT';
  if (hasBuiltin && hasChatgpt) return 'Ready';
  if (hasChatgpt) return 'Using ChatGPT';
  return 'Connected';
}

/**
 * Handles connect button click.
 * @param {Object} dom - DOM references
 * @param {Function} debugLog - Logger function
 * @param {Function} showError - Error display function
 * @param {Function} hideError - Error hide function
 * @returns {Promise<boolean>} Whether connection succeeded
 */
export async function handleConnect(dom, debugLog, showError, hideError) {
  debugLog('Attempting to connect to ChatGPT...');
  dom.connectBtn.disabled = true;
  setConnectBtnText(dom, 'Connecting...');

  try {
    const result = await chrome.runtime.sendMessage({ action: 'connect' });

    if (result.error) {
      debugLog(`Connection error: ${result.error}`, 'error');
      showError(result.error);
      updateAuthUI(dom, false, []);
      return false;
    } else if (result.success) {
      debugLog(`Connected to ChatGPT: ${result.message || 'Success'}`);
      updateAuthUI(dom, true, []);
      hideError();
      return true;
    } else if (result.needsLogin) {
      debugLog('User needs to log in to ChatGPT');
      chrome.tabs.create({ url: 'https://chatgpt.com' });
      showError('Please log in to ChatGPT, then click Connect again.');
      updateAuthUI(dom, false, []);
      return false;
    } else {
      debugLog(`Connection failed: ${result.message}`, 'error');
      showError(result.message || 'Connection failed.');
      updateAuthUI(dom, false, []);
      return false;
    }
  } catch (error) {
    debugLog(`Connection error: ${error.message}`, 'error');
    showError('Failed to connect. Please try again.');
    updateAuthUI(dom, false, []);
    return false;
  } finally {
    dom.connectBtn.disabled = false;
    // Don't hard-code the label here: updateAuthUI (called via the controller's
    // checkAuthStatus after connect) sets the correct contextual label
    // ("Sign in to ChatGPT" when built-in is ready, "Sign in" otherwise).
    // We only need to clear the transient "Connecting..." state; the next
    // updateAuthUI pass will overwrite text + class.
  }
}

/**
 * Handles disconnect button click.
 * @param {Object} dom - DOM references
 * @param {Function} debugLog - Logger function
 * @param {Function} showError - Error display function
 * @param {Function} hideError - Error hide function
 * @param {Function} hideSummary - Summary hide function
 */
export async function handleDisconnect(dom, debugLog, showError, hideError, hideSummary) {
  debugLog('Disconnecting from ChatGPT...');
  try {
    await chrome.runtime.sendMessage({ action: 'disconnect' });
    updateAuthUI(dom, false, []);
    hideError();
    hideSummary();
    debugLog('Disconnected from ChatGPT');
  } catch (error) {
    debugLog(`Disconnect error: ${error.message}`, 'error');
    showError('Failed to disconnect.');
  }
}

function setConnectBtnText(dom, text) {
  const btnTextEl = dom.connectBtn.querySelector('.btn-text');
  if (btnTextEl) {
    btnTextEl.textContent = text;
  } else {
    dom.connectBtn.textContent = text;
  }
}
