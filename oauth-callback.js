// OAuth callback handler
// Extracts code and state from URL, sends to background.js for token exchange

(function() {
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');
  const state = urlParams.get('state');
  const error = urlParams.get('error');
  const errorDesc = urlParams.get('error_description');

  const statusEl = document.getElementById('status');
  const messageEl = document.getElementById('message');

  if (error) {
    statusEl.textContent = 'Authentication Failed';
    messageEl.textContent = errorDesc || error;
    messageEl.classList.add('error');
    return;
  }

  if (!code || !state) {
    statusEl.textContent = 'Invalid Callback';
    messageEl.textContent = 'Missing code or state parameter';
    messageEl.classList.add('error');
    return;
  }

  // Send to background service worker
  chrome.runtime.sendMessage({
    action: 'oauth_callback',
    code: code,
    state: state
  }, (response) => {
    if (response && response.success) {
      statusEl.textContent = 'Authentication Successful';
      messageEl.textContent = "You're now signed in. You can close this tab.";
    } else {
      statusEl.textContent = 'Authentication Failed';
      messageEl.textContent = response?.error || 'Unknown error';
      messageEl.classList.add('error');
    }
  });
})();
