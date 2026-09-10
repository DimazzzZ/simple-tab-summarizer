/**
 * Authentication feature module.
 * Handles connect/disconnect logic and auth UI updates.
 */

import { SUPPORTED_LANGUAGES } from '../api/providers/chrome-builtin.js';

const AUTH_ICONS = {
  connected: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  disconnected: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>'
};

// Languages the built-in Summarizer can produce. Derived directly from the
// provider's own SUPPORTED_LANGUAGES map so the two can never drift apart —
// previously this was a hand-maintained copy. test-auth-ui.js also asserts the
// derived list matches, as belt-and-suspenders.
const BUILTIN_LANGUAGES = Object.keys(SUPPORTED_LANGUAGES);

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
 * @returns {{fellBackToAuto: boolean}} Whether the selected provider became
 *          unusable and the selector was reset to 'auto'. The caller MUST
 *          persist this (see ui-controller) because assigning select.value in
 *          code does not fire a 'change' event.
 */
export function updateAuthUI(dom, authenticated, availableProviders = [], language = 'English', preference = 'auto', builtinStatus = null) {
  const hasBuiltin = availableProviders.includes('chrome-builtin');
  // Distinguish "ready now" (cached) from "will download on first use". When
  // builtinStatus isn't provided (older call sites), fall back to the boolean.
  const builtinReady = builtinStatus
    ? builtinStatus === 'available'
    : hasBuiltin;
  const builtinDownloadable = builtinStatus === 'downloadable' || builtinStatus === 'downloading';
  const hasChatgpt = availableProviders.includes('chatgpt-codex');
  const builtinSupportsLanguage = BUILTIN_LANGUAGES.includes(language);
  // When at least one provider is already usable, signing in is OPTIONAL.
  // We render the Connect control as a subtle text link in that case, and
  // as a primary filled button when sign-in is the ONLY way to summarize.
  let connectEmphasis = 'primary'; // 'primary' | 'subtle'
  let connectLabel = 'Sign in';
  if (authenticated) {
    dom.authIcon.classList.remove('disconnected');
    dom.authIcon.classList.add('connected');
    dom.authIcon.innerHTML = AUTH_ICONS.connected;
    dom.connectBtn.classList.add('hidden');
    dom.disconnectBtn.classList.remove('hidden');
  } else {
    dom.authIcon.classList.remove('connected');
    dom.authIcon.classList.add('disconnected');
    dom.authIcon.innerHTML = AUTH_ICONS.disconnected;
    if (hasBuiltin) {
      // Built-in AI works — sign-in is optional. De-emphasize the control.
      connectEmphasis = 'subtle';
      connectLabel = 'Sign in to ChatGPT';
    } else {
      // Sign-in is the only path forward (either language isn't supported by
      // built-in, or built-in is unavailable entirely).
      connectEmphasis = 'primary';
      connectLabel = 'Sign in';
    }
    dom.connectBtn.classList.remove('hidden');
    dom.disconnectBtn.classList.add('hidden');
    // Apply emphasis + label to the Connect button.
    dom.connectBtn.classList.toggle('btn-subtle', connectEmphasis === 'subtle');
    setConnectBtnText(dom, connectLabel);
  }
  // Status now lives INSIDE the provider selector's option labels — no
  // separate text label to update.
  return updateProviderSelector(dom, {
    authenticated,
    builtinReady,
    builtinDownloadable,
    builtinSupportsLanguage,
    hasChatgpt,
    language,
    preference
  });
}

/**
 * Builds the auth-row status text for the authenticated case, honoring the
 * user's provider preference so they can see which backend will actually run.
 * @param {boolean} hasBuiltin
 * @param {boolean} hasChatgpt
 * @param {string} preference 'auto' | 'chrome-builtin' | 'chatgpt-codex'
 * @returns {string}
 */
/**
 * Rewrites the provider <select>'s option labels so they carry state, disables
 * unusable options, and updates the select-level tooltip with a one-line
 * summary. This is the *only* status surface now — there is no #auth-text
 * label sitting beside the select.
 *
 * Symbols: ✓ = ready / signed in.  ↓ = will download on first use.
 * Unavailable options are labeled with a reason and marked `disabled`.
 *
 * @param {Object} dom
 * @param {{authenticated:boolean, builtinReady:boolean, builtinDownloadable:boolean,
 *          builtinSupportsLanguage:boolean, hasChatgpt:boolean,
 *          language:string, preference:string}} state
 * @returns {{fellBackToAuto: boolean}} Whether the previously-selected option
 *          became disabled and the selector was reset to 'auto'. Setting
 *          select.value programmatically does NOT fire a 'change' event, so the
 *          caller is responsible for syncing its own preference state + storage
 *          when this is true. Returns {fellBackToAuto:false} when there's no
 *          select element or no fallback happened.
 */
export function updateProviderSelector(dom, state) {
  const select = dom.providerSelect;
  if (!select) return { fellBackToAuto: false };
  const {
    authenticated, builtinReady, builtinDownloadable,
    builtinSupportsLanguage, hasChatgpt, language, preference
  } = state;

  // --- Built-in AI option ------------------------------------------------
  const builtinOpt = select.querySelector('option[value="chrome-builtin"]');
  if (builtinOpt) {
    if (!builtinSupportsLanguage) {
      builtinOpt.textContent = `Built-in AI — no ${language}`;
      builtinOpt.title = `Built-in AI supports only English, Japanese, Spanish, German, French. Pick ChatGPT to summarize in ${language}.`;
      builtinOpt.disabled = true;
    } else if (builtinReady) {
      builtinOpt.textContent = 'Built-in AI ✓';
      builtinOpt.title = 'On-device built-in AI is ready. Runs offline after the initial model download.';
      builtinOpt.disabled = false;
    } else if (builtinDownloadable) {
      builtinOpt.textContent = 'Built-in AI ↓';
      builtinOpt.title = 'On-device built-in AI will be downloaded the first time you summarize (~2 GB). Subsequent runs are offline.';
      builtinOpt.disabled = false;
    } else {
      builtinOpt.textContent = 'Built-in AI — unavailable';
      builtinOpt.title = 'Built-in AI is not available in this browser or on this device.';
      builtinOpt.disabled = true;
    }
  }

  // --- ChatGPT option ----------------------------------------------------
  const chatgptOpt = select.querySelector('option[value="chatgpt-codex"]');
  if (chatgptOpt) {
    if (authenticated && hasChatgpt) {
      chatgptOpt.textContent = 'ChatGPT ✓';
      chatgptOpt.title = 'Signed in to ChatGPT.';
      chatgptOpt.disabled = false;
    } else {
      chatgptOpt.textContent = 'ChatGPT — sign in needed';
      chatgptOpt.title = 'Sign in to ChatGPT to enable this provider.';
      chatgptOpt.disabled = true;
    }
  }

  // --- Auto option: show which provider Auto currently resolves to ------
  const autoOpt = select.querySelector('option[value="auto"]');
  if (autoOpt) {
    const resolved = autoResolvedLabel({ builtinReady, builtinDownloadable, builtinSupportsLanguage, hasChatgpt, authenticated });
    autoOpt.textContent = resolved ? `Auto (${resolved})` : 'Auto';
    autoOpt.title = resolved
      ? `Auto — currently uses ${resolved}. Falls back automatically if that changes.`
      : 'Auto — no provider available yet. Sign in to ChatGPT or wait for built-in AI to become available.';
    autoOpt.disabled = false;
  }

  // Select-level tooltip mirrors the currently-selected option so hovering
  // the pill (not just the open dropdown) explains the state.
  const current = select.options[select.selectedIndex];
  select.title = current ? current.title || current.textContent : 'AI Provider';
  // If the previously selected option is now disabled, fall back to Auto so
  // the user isn't stuck with an unusable selection. We flip the visible value
  // here, but report it so the caller can sync its persisted preference —
  // assigning select.value in code does NOT fire a 'change' event.
  let fellBackToAuto = false;
  if (current && current.disabled) {
    select.value = 'auto';
    fellBackToAuto = true;
    const newCurrent = select.options[select.selectedIndex];
    if (newCurrent) select.title = newCurrent.title || newCurrent.textContent;
  }
  // `preference` is only used indirectly here — the selected value is the
  // source of truth. Referencing it here silences the unused-var warning and
  // makes the intent explicit.
  void preference;
  return { fellBackToAuto };
}

/**
 * What "Auto" currently resolves to, given the visible state. Returns a
 * short human label ("Built-in AI", "Built-in AI ↓", "ChatGPT") or null if
 * nothing is available yet.
 */
function autoResolvedLabel({ builtinReady, builtinDownloadable, builtinSupportsLanguage, hasChatgpt, authenticated }) {
  if (builtinSupportsLanguage && builtinReady) return 'Built-in AI';
  if (builtinSupportsLanguage && builtinDownloadable) return 'Built-in AI ↓';
  if (authenticated && hasChatgpt) return 'ChatGPT';
  return null;
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
