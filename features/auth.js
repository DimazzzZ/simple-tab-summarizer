/**
 * Authentication feature module.
 * Handles connect/disconnect logic and auth UI updates.
 */

const AUTH_ICONS = {
  connected: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  disconnected: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>'
};

/**
 * Checks authentication status via background script.
 * @param {Object} dom - DOM references
 * @param {Function} debugLog - Logger function
 * @returns {Promise<boolean>} Whether user is authenticated
 */
export async function checkAuthStatus(dom, debugLog) {
  try {
    debugLog('Checking auth status...');
    const response = await chrome.runtime.sendMessage({ action: 'check_auth' });
    const authenticated = response.authenticated;
    debugLog(`Auth status: ${authenticated ? 'Connected' : 'Not connected'}`);
    updateAuthUI(dom, authenticated);
    return authenticated;
  } catch (error) {
    debugLog(`Auth check error: ${error.message}`, 'error');
    updateAuthUI(dom, false);
    return false;
  }
}

/**
 * Updates the auth UI elements.
 * @param {Object} dom - DOM references
 * @param {boolean} authenticated - Whether user is authenticated
 */
export function updateAuthUI(dom, authenticated) {
  if (authenticated) {
    dom.authIcon.classList.remove('disconnected');
    dom.authIcon.classList.add('connected');
    dom.authIcon.innerHTML = AUTH_ICONS.connected;
    dom.authText.textContent = 'Connected to ChatGPT';
    dom.connectBtn.classList.add('hidden');
    dom.disconnectBtn.classList.remove('hidden');
  } else {
    dom.authIcon.classList.remove('connected');
    dom.authIcon.classList.add('disconnected');
    dom.authIcon.innerHTML = AUTH_ICONS.disconnected;
    dom.authText.textContent = 'Not connected';
    dom.connectBtn.classList.remove('hidden');
    dom.disconnectBtn.classList.add('hidden');
    dom.summarizeBtn.disabled = true;
  }
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
      updateAuthUI(dom, false);
      return false;
    } else if (result.success) {
      debugLog(`Connected to ChatGPT: ${result.message || 'Success'}`);
      updateAuthUI(dom, true);
      hideError();
      return true;
    } else if (result.needsLogin) {
      debugLog('User needs to log in to ChatGPT');
      chrome.tabs.create({ url: 'https://chatgpt.com' });
      showError('Please log in to ChatGPT, then click Connect again.');
      updateAuthUI(dom, false);
      return false;
    } else {
      debugLog(`Connection failed: ${result.message}`, 'error');
      showError(result.message || 'Connection failed.');
      updateAuthUI(dom, false);
      return false;
    }
  } catch (error) {
    debugLog(`Connection error: ${error.message}`, 'error');
    showError('Failed to connect. Please try again.');
    updateAuthUI(dom, false);
    return false;
  } finally {
    dom.connectBtn.disabled = false;
    setConnectBtnText(dom, 'Connect to ChatGPT');
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
    updateAuthUI(dom, false);
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
