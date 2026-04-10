/**
 * Background Service Worker for Tab Group Summarizer
 * 
 * Uses OpenAI Codex OAuth PKCE flow (like Cline).
 * Opens auth.openai.com for sign-in, intercepts callback, exchanges code for tokens.
 */

// ============================================
// Configuration
// ============================================

const CHATGPT_API_URL = 'https://chatgpt.com/backend-api/conversation';
const CHATGPT_MODEL = 'gpt-4o';

const OAUTH_CONFIG = {
  authorizationEndpoint: 'https://auth.openai.com/oauth/authorize',
  tokenEndpoint: 'https://auth.openai.com/oauth/token',
  clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
  redirectUri: 'http://localhost:1455/auth/callback',
  scopes: 'openid profile email offline_access',
  callbackPort: 1455
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
    response_type: 'code',
    client_id: OAUTH_CONFIG.clientId,
    redirect_uri: OAUTH_CONFIG.redirectUri,
    scope: OAUTH_CONFIG.scopes,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state: state,
    codex_cli_simplified_flow: 'true',
    originator: 'tab-group-summarizer'
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
  if (!creds) return null;
  
  // Check if token is expired (with 5 min buffer)
  const now = Date.now();
  if (creds.expires_at && creds.expires_at - now < 5 * 60 * 1000) {
    // Try to refresh
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

async function refreshAccessToken(refreshToken) {
  try {
    const response = await fetch(OAUTH_CONFIG.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: OAUTH_CONFIG.clientId
      })
    });
    
    if (!response.ok) {
      console.error('Token refresh failed:', response.status);
      return null;
    }
    
    const data = await response.json();
    const creds = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || refreshToken,
      expires_at: Date.now() + (data.expires_in * 1000)
    };
    
    await storeCredentials(creds);
    return creds;
  } catch (e) {
    console.error('Token refresh error:', e);
    return null;
  }
}

async function exchangeCodeForTokens(code, codeVerifier) {
  try {
    const response = await fetch(OAUTH_CONFIG.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code: code,
        code_verifier: codeVerifier,
        client_id: OAUTH_CONFIG.clientId,
        redirect_uri: OAUTH_CONFIG.redirectUri
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token exchange failed: ${response.status} - ${errorText}`);
    }
    
    const data = await response.json();
    const creds = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || '',
      expires_at: Date.now() + (data.expires_in * 1000)
    };
    
    await storeCredentials(creds);
    return creds;
  } catch (e) {
    console.error('Token exchange error:', e);
    throw e;
  }
}

// ============================================
// OAuth Flow
// ============================================

let pendingAuth = null;

async function startOAuthFlow() {
  // Cancel any existing flow
  if (pendingAuth) {
    pendingAuth.cancelled = true;
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
  
  const authUrl = buildAuthorizationUrl(codeChallenge, state);
  
  // Open auth tab
  const tab = await chrome.tabs.create({ url: authUrl, active: true });
  pendingAuth.tabId = tab.id;
  
  // Set up listener for callback
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Authentication timed out. Please try again.'));
    }, 5 * 60 * 1000); // 5 minutes
    
    function cleanup() {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(onTabUpdated);
      chrome.tabs.onRemoved.removeListener(onTabRemoved);
      if (pendingAuth && !pendingAuth.cancelled) {
        pendingAuth = null;
      }
    }
    
    async function onTabUpdated(tabId, changeInfo, tab) {
      if (tabId !== pendingAuth?.tabId || pendingAuth.cancelled) return;
      
      if (changeInfo.url) {
        const url = new URL(changeInfo.url);
        
        // Check if this is the callback
        if (url.hostname === 'localhost' && url.port === String(OAUTH_CONFIG.callbackPort) && url.pathname === '/auth/callback') {
          const code = url.searchParams.get('code');
          const returnedState = url.searchParams.get('state');
          const error = url.searchParams.get('error');
          
          if (error) {
            cleanup();
            reject(new Error(`Authentication failed: ${error}`));
            return;
          }
          
          if (!code || !returnedState) {
            cleanup();
            reject(new Error('Missing code or state parameter'));
            return;
          }
          
          if (returnedState !== pendingAuth.state) {
            cleanup();
            reject(new Error('State mismatch - possible CSRF attack'));
            return;
          }
          
          try {
            // Exchange code for tokens
            const creds = await exchangeCodeForTokens(code, pendingAuth.codeVerifier);
            
            // Show success page
            await chrome.tabs.update(tabId, {
              url: 'data:text/html,' + encodeURIComponent(`
                <!DOCTYPE html>
                <html>
                <head><title>Authentication Successful</title>
                <style>
                  body { font-family: system-ui; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #1a1a2e; color: #fff; }
                  .container { text-align: center; padding: 48px; }
                  .icon { width: 72px; height: 72px; margin: 0 auto 24px; background: linear-gradient(135deg, #10a37f, #1a7f64); border-radius: 50%; display: flex; align-items: center; justify-content: center; }
                  h1 { font-size: 24px; margin-bottom: 12px; }
                  p { color: rgba(255,255,255,0.7); }
                </style></head>
                <body><div class="container">
                  <div class="icon"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg></div>
                  <h1>Authentication Successful</h1>
                  <p>You're now signed in. You can close this tab.</p>
                </div></body></html>
              `)
            });
            
            cleanup();
            resolve({ success: true, message: 'Connected!' });
          } catch (e) {
            cleanup();
            reject(e);
          }
        }
      }
    }
    
    function onTabRemoved(tabId) {
      if (tabId === pendingAuth?.tabId && !pendingAuth.cancelled) {
        cleanup();
        reject(new Error('Authentication cancelled'));
      }
    }
    
    chrome.tabs.onUpdated.addListener(onTabUpdated);
    chrome.tabs.onRemoved.addListener(onTabRemoved);
  });
}

// ============================================
// Message Handler
// ============================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'summarize') {
    handleSummarizeRequest(message.contents, message.tabCount)
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
});

// ============================================
// Summarization Logic
// ============================================

async function handleSummarizeRequest(contents, tabCount) {
  try {
    const token = await getAccessToken();
    if (!token) {
      return { text: null, error: 'Not connected. Please connect to ChatGPT first.' };
    }

    const userMessage = buildUserMessage(contents, tabCount);
    const truncatedMessage = truncateMessage(userMessage, 100000);
    const summary = await callAPI(truncatedMessage, token);
    
    return { text: summary, error: null };
  } catch (error) {
    console.error('Summarization error:', error);
    return { text: null, error: `Failed to generate summary: ${error.message}` };
  }
}

function buildUserMessage(contents, tabCount) {
  let message = `Please summarize the following content from ${tabCount} browser tabs:\n\n`;
  
  contents.forEach((content, index) => {
    message += `--- Tab ${index + 1}: ${content.title} ---\n`;
    message += `URL: ${content.url}\n`;
    message += `Content:\n${content.content}\n\n`;
  });
  
  message += `\nPlease provide a comprehensive summary of all the above content.`;
  return message;
}

function truncateMessage(message, maxLength) {
  if (message.length <= maxLength) return message;
  
  const tabSections = message.split('--- Tab ');
  const truncated = [tabSections[0]];
  
  for (let i = 1; i < tabSections.length; i++) {
    const section = '--- Tab ' + tabSections[i];
    const remainingSpace = maxLength - truncated.join('').length - 100;
    
    if (remainingSpace <= 0) break;
    
    if (section.length <= remainingSpace) {
      truncated.push(section);
    } else {
      truncated.push(section.substring(0, remainingSpace) + '\n[Content truncated]');
      break;
    }
  }
  
  return truncated.join('');
}

async function callAPI(message, token) {
  const response = await fetch(CHATGPT_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'Origin': 'https://chatgpt.com',
      'Referer': 'https://chatgpt.com/'
    },
    body: JSON.stringify({
      action: 'next',
      messages: [
        {
          id: crypto.randomUUID(),
          author: { role: 'user' },
          content: { content_type: 'text', parts: [message] }
        }
      ],
      parent_message_id: crypto.randomUUID(),
      model: CHATGPT_MODEL,
      timezone_offset_min: new Date().getTimezoneOffset()
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 401 || response.status === 403) {
      throw new Error('Authentication failed. Please reconnect to ChatGPT.');
    }
    throw new Error(`API error (${response.status}): ${errorText.substring(0, 200)}`);
  }

  // Parse SSE stream
  const text = await response.text();
  const lines = text.split('\n');
  let result = '';
  
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const data = line.substring(6);
      if (data === '[DONE]') break;
      try {
        const parsed = JSON.parse(data);
        if (parsed.message?.content?.parts?.[0]) {
          result = parsed.message.content.parts[0];
        }
      } catch (e) {
        // Skip invalid JSON
      }
    }
  }
  
  return result || text;
}
