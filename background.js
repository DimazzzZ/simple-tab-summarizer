/**
 * Background Service Worker for Tab Group Summarizer
 * 
 * Uses OpenAI Codex OAuth PKCE flow.
 * Opens auth.openai.com for sign-in, intercepts localhost callback, exchanges code for tokens.
 * Uses the access_token with the ChatGPT Codex backend (chatgpt.com/backend-api/codex/responses).
 * Includes ChatGPT-Account-ID header when authenticated via ChatGPT OAuth.
 */

// ============================================
// Configuration
// ============================================

const CHATGPT_API_URL = 'https://chatgpt.com/backend-api/codex/responses';
const OPENAI_MODEL = 'gpt-5.4';

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

    const userMessage = buildUserMessage(contents);
    const truncatedMessage = truncateMessage(userMessage, 100000);
    const summary = await callOpenAIAPI(truncatedMessage, tabCount, accessToken, language, summaryLevel, signal);
    
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

async function callOpenAIAPI(message, tabCount, accessToken, language = 'English', summaryLevel = 'short', signal = null) {
  const accountId = await getAccountId();
  console.log('[API] Using account_id:', accountId);
  
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`
  };
  
  // Add ChatGPT-Account-ID header if we have it
  if (accountId) {
    headers['ChatGPT-Account-ID'] = accountId;
  }
  
  const langInstruction = `Output must be in ${language}.`;
  const noiseFilter = 'The text below is raw text extracted from a webpage. It may contain navigation, headers, footers, sidebars, ads, and other non-content elements. Identify the actual main content and summarize only that — ignore UI chrome, menus, links, and boilerplate.';
  const levelInstructions = {
    short: tabCount <= 1
      ? 'Summarize the page content in ONE very concise paragraph (max 80 words). Focus only on the core message. Return only the paragraph — no headings, no bullets, no extra text.'
      : 'For each page section marked "=== PAGE N ===", write ONE very concise paragraph (max 60 words) summarizing that page. Focus only on the core message. Separate each summary with "=== PAGE N ===" matching the input. No headings, no bullets, no extra text. Return only the summaries.',
    medium: tabCount <= 1
      ? 'Summarize the page content in ONE paragraph (max 120 words). Cover the main points and key takeaways. Return only the paragraph — no headings, no bullets, no extra text.'
      : 'For each page section marked "=== PAGE N ===", write ONE paragraph (max 100 words) summarizing that page. Cover the main points and key takeaways. Separate each summary with "=== PAGE N ===" matching the input. No headings, no bullets, no extra text. Return only the summaries.',
    detailed: tabCount <= 1
      ? 'Provide a detailed summary of the page content (max 300 words). Cover all important points, key details, and notable context. You may use multiple paragraphs. Return only the summary — no headings, no bullets, no extra text.'
      : 'For each page section marked "=== PAGE N ===", provide a detailed summary (max 250 words) covering all important points and key details. You may use multiple paragraphs per section. Separate each summary with "=== PAGE N ===" matching the input. No headings, no bullets, no extra text. Return only the summaries.'
  };
  const instructions = `${langInstruction} ${noiseFilter} ${levelInstructions[summaryLevel] || levelInstructions.short}`;
  
  const body = JSON.stringify({
    model: OPENAI_MODEL,
    instructions: instructions,
    input: [{
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: message }]
    }],
    reasoning: { effort: 'low' },
    store: false,
    stream: true
  });

  let response = await fetch(CHATGPT_API_URL, {
    method: 'POST',
    headers,
    body,
    signal
  });

  // If reasoning is rejected, retry without it
  if (!response.ok) {
    const errText = await response.text();
    if (response.status === 400 && errText.includes('Unsupported parameter')) {
      console.log('[API] Retrying without optional params...');
      const fallbackBody = JSON.stringify({
        model: OPENAI_MODEL,
        instructions: instructions,
        input: [{
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: message }]
        }],
        store: false,
        stream: true
      });
      response = await fetch(CHATGPT_API_URL, {
        method: 'POST',
        headers,
        body: fallbackBody,
        signal
      });
      if (!response.ok) {
        const retryErrText = await response.text();
        console.error('[API] Error response:', response.status, retryErrText.substring(0, 500));
        if (response.status === 401 || response.status === 403) {
          throw new Error('Authentication failed. Please reconnect to ChatGPT.');
        }
        throw new Error(`API error (${response.status}): ${retryErrText.substring(0, 200)}`);
      }
    } else {
      console.error('[API] Error response:', response.status, errText.substring(0, 500));
      if (response.status === 401 || response.status === 403) {
        throw new Error('Authentication failed. Please reconnect to ChatGPT.');
      }
      throw new Error(`API error (${response.status}): ${errText.substring(0, 200)}`);
    }
  }

  // Check if response is SSE (streaming)
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/event-stream')) {
    console.log('[API] Detected SSE content-type, using stream parser');
    return parseSSEStream(response.body);
  }
  
  // Try JSON first, but fall back to SSE if body starts with "event:" or "data:"
  const rawText = await response.text();
  console.log('[API] Response text preview:', rawText.substring(0, 100));
  
  if (rawText.startsWith('event:') || rawText.startsWith('data:')) {
    console.log('[API] Response is SSE format despite JSON content-type, using stream parser');
    return parseSSEText(rawText);
  }
  
  try {
    const data = JSON.parse(rawText);
    console.log('[API] Response keys:', Object.keys(data));
    
    if (data.output_text) {
      return data.output_text;
    }
    
    if (data.output && Array.isArray(data.output)) {
      for (const item of data.output) {
        if (item.content && Array.isArray(item.content)) {
          for (const content of item.content) {
            if (content.text) {
              return content.text;
            }
          }
        }
      }
    }
    
    return JSON.stringify(data, null, 2);
  } catch (e) {
    console.error('[API] JSON parse error:', e.message);
    throw new Error(`Failed to parse API response: ${e.message}`);
  }
}

async function parseSSEStream(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let completed = false;
  let receivedDeltas = false;
  
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;
        
        if (trimmed.startsWith('data:')) {
          const dataStr = trimmed.substring(5).trim();
          try {
            const event = JSON.parse(dataStr);
            const eventType = event.type;
            
            if (eventType === 'response.output_text.delta' && event.delta) {
              fullText += event.delta;
              receivedDeltas = true;
            } else if (eventType === 'response.output_item.done') {
              // Only use output_item.done text if we didn't receive deltas
              if (!receivedDeltas) {
                const item = event.item;
                if (item && item.content) {
                  for (const c of item.content) {
                    if (c.text) fullText += c.text;
                  }
                }
              }
            } else if (eventType === 'response.completed') {
              completed = true;
            } else if (eventType === 'response.error') {
              throw new Error(event.error?.message || 'Stream error');
            }
          } catch (e) {
            if (e.message && !e.message.includes('Unexpected token')) {
              throw e;
            }
          }
        }
      }
      
      if (completed) break;
    }
  } finally {
    reader.releaseLock();
  }
  
  if (!fullText && !completed) {
    return '[No content received from stream]';
  }
  
  return fullText || '[Stream completed with no content]';
}

function parseSSEText(text) {
  const lines = text.split('\n');
  let fullText = '';
  let completed = false;
  let receivedDeltas = false;
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(':')) continue;
    
    if (trimmed.startsWith('data:')) {
      const dataStr = trimmed.substring(5).trim();
      try {
        const event = JSON.parse(dataStr);
        const eventType = event.type;
        
        if (eventType === 'response.output_text.delta' && event.delta) {
          fullText += event.delta;
          receivedDeltas = true;
        } else if (eventType === 'response.output_item.done') {
          // Only use output_item.done text if we didn't receive deltas
          if (!receivedDeltas) {
            const item = event.item;
            if (item && item.content) {
              for (const c of item.content) {
                if (c.text) fullText += c.text;
              }
            }
          }
        } else if (eventType === 'response.completed') {
          completed = true;
        } else if (eventType === 'response.error') {
          throw new Error(event.error?.message || 'Stream error');
        }
      } catch (e) {
        if (e.message && !e.message.includes('Unexpected token')) {
          throw e;
        }
      }
    }
  }
  
  if (!fullText && !completed) {
    return '[No content received from stream]';
  }
  
  return fullText || '[Stream completed with no content]';
}
