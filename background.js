/**
 * Background Service Worker for Tab Group Summarizer
 * 
 * Uses OpenAI Codex OAuth PKCE flow.
 * Opens auth.openai.com for sign-in, intercepts localhost callback, exchanges code for tokens.
 * Uses the access_token with the ChatGPT Codex backend (chatgpt.com/backend-api/codex/responses).
 * Includes ChatGPT-Account-ID header when authenticated via ChatGPT OAuth.
 */

import { summarizeViaCodex } from './api/codex-client.js';
import { LAST_SEEN_WHATS_NEW_KEY } from './constants/ui-keys.js';
import { WHATS_NEW_VERSIONS } from './constants/whats-new-data.generated.js';
import { versionsNewerThan } from './utils/whats-new.js';

// ============================================
// Configuration
// ============================================

// (CHATGPT_API_URL, OPENAI_MODEL_CANDIDATES, and the model-unsupported classifier
//  now live in api/codex-client.js — see summarizeViaCodex.)

const OAUTH_CONFIG = {
  authorizationEndpoint: 'https://auth.openai.com/oauth/authorize',
  tokenEndpoint: 'https://auth.openai.com/oauth/token',
  clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
  redirectUri: 'http://localhost:1455/auth/callback',
  scopes: 'openid profile email offline_access api.connectors.read api.connectors.invoke'
};

// ============================================
// PKCE Helpers
// ============================================

function generateCodeVerifier() {
  const buffer = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...buffer))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function generateState() {
  const buffer = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(buffer).map(b => b.toString(16).padStart(2, '0')).join('');
}

function buildAuthorizationUrl(codeChallenge, state) {
  const params = new URLSearchParams({
    client_id: OAUTH_CONFIG.clientId,
    redirect_uri: OAUTH_CONFIG.redirectUri,
    scope: OAUTH_CONFIG.scopes,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    response_type: 'code',
    state: state,
    codex_cli_simplified_flow: 'true',
    originator: 'cline'
  });
  return `${OAUTH_CONFIG.authorizationEndpoint}?${params.toString()}`;
}

// ============================================
// Token Management
// ============================================

async function getStoredCredentials() {
  const result = await chrome.storage.local.get('openai_codex_credentials');
  return result.openai_codex_credentials || null;
}

async function storeCredentials(creds) {
  await chrome.storage.local.set({ openai_codex_credentials: creds });
}

async function clearCredentials() {
  await chrome.storage.local.remove('openai_codex_credentials');
}

async function getAccessToken() {
  const creds = await getStoredCredentials();
  if (!creds || !creds.access_token) return null;
  
  // Check if token is expired (with 5 min buffer)
  const now = Date.now();
  if (creds.expires_at && creds.expires_at - now < 5 * 60 * 1000) {
    if (creds.refresh_token) {
      const refreshed = await refreshAccessToken(creds.refresh_token);
      if (refreshed) {
        return refreshed.access_token;
      }
    }
    return null;
  }
  
  return creds.access_token;
}

/**
 * Get the stored account_id (ChatGPT-Account-ID header value).
 */
async function getAccountId() {
  const creds = await getStoredCredentials();
  return creds?.account_id || null;
}

async function refreshAccessToken(refreshToken) {
  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: OAUTH_CONFIG.clientId
    });

    const response = await fetch(OAUTH_CONFIG.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
    
    if (!response.ok) {
      console.error('Token refresh failed:', response.status);
      return null;
    }
    
    const data = await response.json();
    const existingCreds = await getStoredCredentials();
    const creds = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || refreshToken,
      expires_at: Date.now() + (data.expires_in * 1000),
      // Preserve account_id from original auth
      account_id: existingCreds?.account_id || null
    };
    
    await storeCredentials(creds);
    return creds;
  } catch (e) {
    console.error('Token refresh error:', e);
    return null;
  }
}

/**
 * Decode a JWT payload (without verification) to extract claims.
 * Returns null if the token cannot be decoded.
 */
function decodeJwtPayload(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1];
    // Add padding if needed
    const padded = payload.padEnd(payload.length + (4 - payload.length % 4) % 4, '=');
    const decoded = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

/**
 * Extract the ChatGPT account ID from the id_token JWT.
 * The id_token contains claims at https://api.openai.com/auth.chatgpt_account_id
 */
function extractAccountIdFromIdToken(idToken) {
  const claims = decodeJwtPayload(idToken);
  if (!claims) return null;
  
  // Try the nested claim path first
  const authClaims = claims['https://api.openai.com/auth'];
  if (authClaims?.chatgpt_account_id) {
    return authClaims.chatgpt_account_id;
  }
  
  // Try flat claim
  if (claims.chatgpt_account_id) {
    return claims.chatgpt_account_id;
  }
  
  // Try sub claim
  if (claims.sub) {
    return claims.sub;
  }
  
  return null;
}

async function exchangeCodeForTokens(code, codeVerifier) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: OAUTH_CONFIG.clientId,
    code: code,
    redirect_uri: OAUTH_CONFIG.redirectUri,
    code_verifier: codeVerifier
  });

  const response = await fetch(OAUTH_CONFIG.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token exchange failed: ${response.status} - ${errorText}`);
  }
  
  const data = await response.json();
  console.log('[OAuth] Token response keys:', Object.keys(data));
  if (data.scope) console.log('[OAuth] Granted scopes:', data.scope);
  
  // Extract account_id from id_token if present
  const accountId = data.id_token ? extractAccountIdFromIdToken(data.id_token) : null;
  console.log('[OAuth] Extracted account_id:', accountId);
  
  const creds = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || '',
    expires_at: Date.now() + (data.expires_in * 1000),
    account_id: accountId
  };
  
  await storeCredentials(creds);
  console.log('[OAuth] Tokens stored! access_token present:', !!creds.access_token, 'account_id present:', !!creds.account_id);
  return creds;
}

// ============================================
// OAuth Flow
// ============================================

let pendingAuth = null;
let currentSummarizationAbortController = null;

async function savePendingAuth() {
  if (pendingAuth) {
    await chrome.storage.local.set({ pending_auth: {
      codeVerifier: pendingAuth.codeVerifier,
      state: pendingAuth.state,
      cancelled: pendingAuth.cancelled,
      tabId: pendingAuth.tabId
    }});
  }
}

async function loadPendingAuth() {
  const result = await chrome.storage.local.get('pending_auth');
  return result.pending_auth || null;
}

async function clearPendingAuth() {
  await chrome.storage.local.remove('pending_auth');
}

// Restore pending auth from storage on service worker startup
(async function init() {
  pendingAuth = await loadPendingAuth();
  if (pendingAuth) {
    console.log('[OAuth] Restored pending auth from storage');
  }
})();

// Listen for tab updates globally to catch callback even if popup closed
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url || !changeInfo.url.includes('localhost:1455/auth/callback')) return;
  
  // Check if we have pending auth
  if (!pendingAuth) {
    pendingAuth = await loadPendingAuth();
  }
  if (!pendingAuth || pendingAuth.cancelled) return;
  
  console.log('[OAuth] Global listener caught callback!');
  
  const url = new URL(changeInfo.url);
  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  
  // Close the tab
  try { await chrome.tabs.remove(tabId); } catch {}
  
  if (error) {
    console.error('[OAuth] Auth error:', error);
    await clearPendingAuth();
    pendingAuth = null;
    return;
  }
  
  if (!code || !returnedState) {
    console.error('[OAuth] Missing code or state');
    await clearPendingAuth();
    pendingAuth = null;
    return;
  }
  
  if (returnedState !== pendingAuth.state) {
    console.error('[OAuth] State mismatch');
    await clearPendingAuth();
    pendingAuth = null;
    return;
  }
  
  try {
    console.log('[OAuth] Exchanging code for tokens...');
    await exchangeCodeForTokens(code, pendingAuth.codeVerifier);
    console.log('[OAuth] Tokens stored!');
    await clearPendingAuth();
    pendingAuth = null;
  } catch (e) {
    console.error('[OAuth] Token exchange error:', e);
    await clearPendingAuth();
    pendingAuth = null;
  }
});

async function startOAuthFlow() {
  if (pendingAuth) {
    pendingAuth.cancelled = true;
    if (pendingAuth.tabId) {
      try { await chrome.tabs.remove(pendingAuth.tabId); } catch {}
    }
  }
  
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = generateState();
  
  pendingAuth = {
    codeVerifier,
    state,
    cancelled: false,
    tabId: null
  };
  
  await savePendingAuth();
  
  const authUrl = buildAuthorizationUrl(codeChallenge, state);
  console.log('[OAuth] Opening auth URL:', authUrl);
  const tab = await chrome.tabs.create({ url: authUrl, active: true });
  pendingAuth.tabId = tab.id;
  await savePendingAuth();
  
  // Return immediately - the global listener will handle the callback
  return { success: true, message: 'Auth window opened. Please sign in, then reopen the extension to check status.' };
}

// ============================================
// Message Handler
// ============================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'summarize') {
    handleSummarizeRequest(message.contents, message.tabCount, message.language, message.summaryLevel)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }

  if (message.action === 'connect') {
    startOAuthFlow()
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }

  if (message.action === 'check_auth') {
    getAccessToken()
      .then(token => sendResponse({ authenticated: !!token }))
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }

  if (message.action === 'disconnect') {
    clearCredentials()
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }

  if (message.action === 'set_display_mode') {
    setDisplayMode(message.mode)
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }

  if (message.action === 'get_display_mode') {
    getDisplayMode()
      .then(mode => sendResponse({ mode }))
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }

  if (message.action === 'stop_summarize') {
    if (currentSummarizationAbortController) {
      currentSummarizationAbortController.abort();
      currentSummarizationAbortController = null;
      console.log('[Summarize] Stop signal sent');
    }
    sendResponse({ success: true });
    return true;
  }

  if (message.action === 'get_whats_new') {
    getUnseenWhatsNewVersions()
      .then(versions => sendResponse({ versions, currentVersion: chrome.runtime.getManifest().version }))
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }

  if (message.action === 'whats_new_seen') {
    markWhatsNewSeen()
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }
});

// ============================================
// Display Mode Management (Popup vs Sidebar)
// ============================================

async function getDisplayMode() {
  const result = await chrome.storage.local.get('displayMode');
  return result.displayMode || 'popup';
}

async function setDisplayMode(mode) {
  await chrome.storage.local.set({ displayMode: mode });
  
  if (mode === 'sidebar') {
    // Sidebar mode: action click toggles side panel
    chrome.action.setPopup({ popup: '' });
    chrome.sidePanel.setOptions({ enabled: true, path: 'sidebar.html' });
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } else {
    // Popup mode: action click opens popup
    chrome.action.setPopup({ popup: 'popup.html' });
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
    // Close any open side panel
    try {
      const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
      for (const win of windows) {
        try { await chrome.sidePanel.setOptions({ enabled: false }); } catch {}
        try { await chrome.sidePanel.setOptions({ enabled: true, path: 'sidebar.html' }); } catch {}
      }
    } catch {}
  }
}

// Initialize display mode on startup
(async function initDisplayMode() {
  const mode = await getDisplayMode();
  await setDisplayMode(mode);
})();

// ============================================
// "What's new" After-Update Notes
// ============================================
//
// Source of truth for "has unseen notes" is LAST_SEEN_WHATS_NEW_KEY vs the
// versions present in WHATS_NEW_VERSIONS (generated from STORE_LISTING.md).
// On a fresh install we record the current version so brand-new users see
// nothing. On update we refresh the toolbar badge; the popup/sidebar renders
// the banner + inline notes and calls back with 'whats_new_seen' to clear it.

async function getLastSeenWhatsNewVersion() {
  const result = await chrome.storage.local.get(LAST_SEEN_WHATS_NEW_KEY);
  return result[LAST_SEEN_WHATS_NEW_KEY] || null;
}

async function setLastSeenWhatsNewVersion(version) {
  await chrome.storage.local.set({ [LAST_SEEN_WHATS_NEW_KEY]: version });
}

async function getUnseenWhatsNewVersions() {
  const lastSeen = await getLastSeenWhatsNewVersion();
  return versionsNewerThan(WHATS_NEW_VERSIONS, lastSeen);
}

function setWhatsNewBadge() {
  try {
    chrome.action.setBadgeText({ text: 'NEW' });
    chrome.action.setBadgeBackgroundColor({ color: '#4a90d9' });
  } catch (e) {
    console.warn('[WhatsNew] Failed to set badge:', e);
  }
}

function clearWhatsNewBadge() {
  try {
    chrome.action.setBadgeText({ text: '' });
  } catch (e) {
    console.warn('[WhatsNew] Failed to clear badge:', e);
  }
}

// Recompute the badge from stored state (used on install/update and startup).
async function refreshWhatsNewBadge() {
  const unseen = await getUnseenWhatsNewVersions();
  if (unseen.length > 0) {
    setWhatsNewBadge();
  } else {
    clearWhatsNewBadge();
  }
}

// Mark all current notes as seen (user opened or dismissed the banner/panel).
async function markWhatsNewSeen() {
  await setLastSeenWhatsNewVersion(chrome.runtime.getManifest().version);
  clearWhatsNewBadge();
}

chrome.runtime.onInstalled.addListener(async ({ reason, previousVersion }) => {
  const current = chrome.runtime.getManifest().version;
  try {
    if (reason === 'install') {
      // Fresh install: don't show release notes to brand-new users.
      await setLastSeenWhatsNewVersion(current);
      clearWhatsNewBadge();
      return;
    }
    if (reason === 'update') {
      // Leave lastSeen at its old value so unseen versions drive the banner.
      // If lastSeen was never set (upgraded from a build predating this
      // feature), seed it from previousVersion so only genuinely new notes show.
      const lastSeen = await getLastSeenWhatsNewVersion();
      if (!lastSeen && previousVersion) {
        await setLastSeenWhatsNewVersion(previousVersion);
      }
      await refreshWhatsNewBadge();
    }
  } catch (e) {
    console.warn('[WhatsNew] onInstalled handling failed:', e);
  }
});

// Re-derive the badge when the service worker wakes on browser startup.
chrome.runtime.onStartup.addListener(() => {
  refreshWhatsNewBadge().catch(() => {});
});

// ============================================
// Summarization Logic
// ============================================

async function handleSummarizeRequest(contents, tabCount, language = 'English', summaryLevel = 'short') {
  currentSummarizationAbortController = new AbortController();
  const { signal } = currentSummarizationAbortController;
  
  try {
    const accessToken = await getAccessToken();
    if (!accessToken) {
      currentSummarizationAbortController = null;
      return { text: null, error: 'Not connected. Please connect to ChatGPT first.' };
    }

    const accountId = await getAccountId();
    const userMessage = buildUserMessage(contents);
    const truncatedMessage = truncateMessage(userMessage, 100000);
    const summary = await summarizeViaCodex({
      message: truncatedMessage,
      tabCount,
      accessToken,
      accountId,
      language,
      summaryLevel,
      signal
    });

    currentSummarizationAbortController = null;
    return { text: summary, error: null };
  } catch (error) {
    currentSummarizationAbortController = null;
    if (error.name === 'AbortError') {
      console.log('[Summarize] Summarization was stopped');
      return { text: null, error: 'Summarization was stopped.' };
    }
    console.error('Summarization error:', error);
    return { text: null, error: `Failed to generate summary: ${error.message}` };
  }
}

function buildUserMessage(contents) {
  const MAX_CHARS_PER_TAB = 30000;
  let message = '';
  
  contents.forEach((content, index) => {
    const clippedContent = content.content.length > MAX_CHARS_PER_TAB
      ? content.content.substring(0, MAX_CHARS_PER_TAB) + '\n[content clipped]'
      : content.content;
    message += `=== PAGE ${index + 1} ===\n`;
    message += `Title: ${content.title}\n`;
    message += `URL: ${content.url}\n`;
    message += `${clippedContent}\n\n`;
  });
  
  return message;
}

function truncateMessage(message, maxLength) {
  if (message.length <= maxLength) return message;
  return message.substring(0, maxLength) + '\n[content clipped]';
}

// ============================================
// Exports for unit tests
// ============================================
export { buildUserMessage, truncateMessage };
