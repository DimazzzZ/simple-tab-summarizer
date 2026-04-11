// DOM Elements
const authIcon = document.getElementById('auth-icon');
const authText = document.getElementById('auth-text');
const connectBtn = document.getElementById('connect-btn');
const disconnectBtn = document.getElementById('disconnect-btn');
const groupSelect = document.getElementById('group-select');
const noGroups = document.getElementById('no-groups');
const pagesSection = document.getElementById('pages-section');
const pagesList = document.getElementById('pages-list');
const selectAllBtn = document.getElementById('select-all-btn');
const deselectAllBtn = document.getElementById('deselect-all-btn');
const languageSelect = document.getElementById('language-select');
const summarizeBtn = document.getElementById('summarize-btn');
const debugConsole = document.getElementById('debug-console');
const debugSection = document.getElementById('debug-section');
const debugToggle = document.getElementById('debug-toggle');
const clearDebugBtn = document.getElementById('clear-debug-btn');
const loadingSection = document.getElementById('loading-section');
const loadingText = document.getElementById('loading-text');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');
const summarySection = document.getElementById('summary-section');
const summaryContent = document.getElementById('summary-content');
const errorSection = document.getElementById('error-section');
const errorMessage = document.getElementById('error-message');

// State
let selectedGroupId = null;
let groupTabs = [];
let selectedTabIds = new Set();
let isAuthenticated = false;
let allGroups = [];
let debugEnabled = false;

// Debug logging
function debugLog(message, type = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  const entry = document.createElement('div');
  entry.className = `debug-entry debug-${type}`;
  entry.textContent = `[${timestamp}] ${message}`;
  if (debugEnabled && debugConsole) {
    debugConsole.appendChild(entry);
    debugConsole.scrollTop = debugConsole.scrollHeight;
  }
  console.log(`[TabGroupSummarizer] ${message}`);
}

// Helper: execute script with timeout
function executeScriptWithTimeout(tabId, files, timeoutMs = 30000) {
  return Promise.race([
    chrome.scripting.executeScript({ target: { tabId }, files }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Script execution timed out after ${timeoutMs}ms`)), timeoutMs)
    )
  ]);
}

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  debugLog('Popup initialized');
  await loadSettings();
  await checkAuthStatus();
  await loadTabGroups();
  setupEventListeners();
});

async function loadSettings() {
  const result = await chrome.storage.local.get(['debugEnabled', 'summaryLanguage']);
  debugEnabled = result.debugEnabled || false;
  debugToggle.checked = debugEnabled;
  updateDebugVisibility();
  
  if (result.summaryLanguage) {
    languageSelect.value = result.summaryLanguage;
  }
}

async function saveSetting(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

function updateDebugVisibility() {
  if (debugEnabled) {
    debugSection.classList.remove('hidden');
  } else {
    debugSection.classList.add('hidden');
  }
}

function setupEventListeners() {
  connectBtn.addEventListener('click', handleConnect);
  disconnectBtn.addEventListener('click', handleDisconnect);
  groupSelect.addEventListener('change', handleGroupSelect);
  selectAllBtn.addEventListener('click', handleSelectAll);
  deselectAllBtn.addEventListener('click', handleDeselectAll);
  summarizeBtn.addEventListener('click', handleSummarize);
  clearDebugBtn.addEventListener('click', () => { debugConsole.innerHTML = ''; debugLog('Debug console cleared'); });
  debugToggle.addEventListener('change', async () => {
    debugEnabled = debugToggle.checked;
    await saveSetting('debugEnabled', debugEnabled);
    updateDebugVisibility();
    debugLog(`Debug console ${debugEnabled ? 'enabled' : 'disabled'}`);
  });
  languageSelect.addEventListener('change', async () => {
    await saveSetting('summaryLanguage', languageSelect.value);
    debugLog(`Summary language changed to: ${languageSelect.value}`);
  });
}

async function checkAuthStatus() {
  try {
    debugLog('Checking auth status...');
    const response = await chrome.runtime.sendMessage({ action: 'check_auth' });
    isAuthenticated = response.authenticated;
    debugLog(`Auth status: ${isAuthenticated ? 'Connected' : 'Not connected'}`);
    updateAuthUI(isAuthenticated);
  } catch (error) {
    debugLog(`Auth check error: ${error.message}`, 'error');
    updateAuthUI(false);
  }
}

function updateAuthUI(authenticated) {
  if (authenticated) {
    authIcon.textContent = '✅';
    authText.textContent = 'Connected to ChatGPT';
    connectBtn.classList.add('hidden');
    disconnectBtn.classList.remove('hidden');
    updateButtonsState();
  } else {
    authIcon.textContent = '🔌';
    authText.textContent = 'Not connected';
    connectBtn.classList.remove('hidden');
    disconnectBtn.classList.add('hidden');
    summarizeBtn.disabled = true;
  }
}

function updateButtonsState() {
  const hasSelection = selectedTabIds.size > 0;
  summarizeBtn.disabled = !isAuthenticated || !hasSelection;
  debugLog(`Buttons updated - Summarize: ${!summarizeBtn.disabled}, Selected tabs: ${selectedTabIds.size}`);
}

async function handleConnect() {
  debugLog('Attempting to connect to ChatGPT...');
  connectBtn.disabled = true;
  connectBtn.querySelector('.btn-text').textContent = 'Connecting...';
  
  try {
    const result = await chrome.runtime.sendMessage({ action: 'connect' });
    
    if (result.error) {
      debugLog(`Connection error: ${result.error}`, 'error');
      showError(result.error);
      updateAuthUI(false);
    } else if (result.success) {
      debugLog(`Connected to ChatGPT: ${result.message || 'Success'}`);
      isAuthenticated = true;
      updateAuthUI(true);
      hideError();
    } else if (result.needsLogin) {
      debugLog('User needs to log in to ChatGPT');
      chrome.tabs.create({ url: 'https://chatgpt.com' });
      showError('Please log in to ChatGPT, then click Connect again.');
      updateAuthUI(false);
    } else {
      debugLog(`Connection failed: ${result.message}`, 'error');
      showError(result.message || 'Connection failed.');
      updateAuthUI(false);
    }
  } catch (error) {
    debugLog(`Connection error: ${error.message}`, 'error');
    showError('Failed to connect. Please try again.');
    updateAuthUI(false);
  } finally {
    connectBtn.disabled = false;
    connectBtn.querySelector('.btn-text').textContent = 'Connect to ChatGPT';
  }
}

async function handleDisconnect() {
  debugLog('Disconnecting from ChatGPT...');
  try {
    await chrome.runtime.sendMessage({ action: 'disconnect' });
    isAuthenticated = false;
    updateAuthUI(false);
    hideError();
    hideSummary();
    debugLog('Disconnected from ChatGPT');
  } catch (error) {
    debugLog(`Disconnect error: ${error.message}`, 'error');
    showError('Failed to disconnect.');
  }
}

async function loadTabGroups() {
  try {
    debugLog('Loading tab groups...');
    allGroups = await chrome.tabGroups.query({});
    debugLog(`Found ${allGroups.length} tab groups`);
    
    if (allGroups.length === 0) {
      groupSelect.classList.add('hidden');
      noGroups.classList.remove('hidden');
      pagesSection.classList.add('hidden');
      return;
    }
    
    groupSelect.classList.remove('hidden');
    noGroups.classList.add('hidden');
    groupSelect.innerHTML = '<option value="">-- Select a group --</option>';
    
    const colorMap = {
      'grey': '#808080', 'blue': '#0066cc', 'red': '#dc3545',
      'yellow': '#ffc107', 'green': '#28a745', 'pink': '#e83e8c',
      'purple': '#6f42c1', 'cyan': '#17a2b8', 'orange': '#fd7e14'
    };
    
    for (const group of allGroups) {
      const tabs = await chrome.tabs.query({ groupId: group.id });
      const option = document.createElement('option');
      option.value = group.id;
      option.textContent = `${group.title || 'Untitled'} (${tabs.length} tab${tabs.length !== 1 ? 's' : ''})`;
      
      const groupColor = colorMap[group.color] || '#808080';
      option.style.borderLeft = `3px solid ${groupColor}`;
      option.style.paddingLeft = '8px';
      
      groupSelect.appendChild(option);
      debugLog(`Group: "${group.title || 'Untitled'}" - ${tabs.length} tabs`);
    }
  } catch (error) {
    debugLog(`Error loading tab groups: ${error.message}`, 'error');
    showError('Failed to load tab groups.');
  }
}

function handleGroupSelect() {
  const selectedValue = groupSelect.value;
  
  if (!selectedValue) {
    selectedGroupId = null;
    groupTabs = [];
    selectedTabIds.clear();
    pagesSection.classList.add('hidden');
    updateButtonsState();
    return;
  }
  
  selectedGroupId = parseInt(selectedValue);
  debugLog(`Selected group ID: ${selectedGroupId}`);
  
  chrome.tabs.query({ groupId: selectedGroupId }).then(tabs => {
    groupTabs = tabs;
    selectedTabIds = new Set(tabs.map(t => t.id));
    debugLog(`Loaded ${tabs.length} tabs in group`);
    renderPagesList();
    pagesSection.classList.remove('hidden');
    updateButtonsState();
    hideSummary();
    hideError();
  }).catch(error => {
    debugLog(`Error loading group tabs: ${error.message}`, 'error');
    showError('Failed to load tabs for this group.');
  });
}

function renderPagesList() {
  pagesList.innerHTML = '';
  
  groupTabs.forEach(tab => {
    const item = document.createElement('label');
    item.className = 'page-item';
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = tab.id;
    checkbox.checked = selectedTabIds.has(tab.id);
    checkbox.addEventListener('change', (e) => {
      if (e.target.checked) {
        selectedTabIds.add(tab.id);
      } else {
        selectedTabIds.delete(tab.id);
      }
      updateButtonsState();
      debugLog(`Tab selection changed: ${selectedTabIds.size} selected`);
    });
    
    const text = document.createElement('span');
    text.className = 'page-title';
    text.textContent = tab.title || 'Untitled';
    text.title = tab.url;
    
    item.appendChild(checkbox);
    item.appendChild(text);
    pagesList.appendChild(item);
  });
  
  debugLog(`Rendered ${groupTabs.length} page checkboxes`);
}

function handleSelectAll() {
  selectedTabIds = new Set(groupTabs.map(t => t.id));
  pagesList.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
  updateButtonsState();
  debugLog(`Selected all ${selectedTabIds.size} tabs`);
}

function handleDeselectAll() {
  selectedTabIds.clear();
  pagesList.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
  updateButtonsState();
  debugLog('Deselected all tabs');
}

async function handleSummarize() {
  if (selectedTabIds.size === 0) {
    showError('No tabs selected.');
    return;
  }

  if (!isAuthenticated) {
    showError('Please connect to ChatGPT first.');
    return;
  }

  const selectedTabs = groupTabs.filter(t => selectedTabIds.has(t.id));
  const summaryLanguage = languageSelect.value || 'English';
  debugLog(`Starting summarization for ${selectedTabs.length} tabs in ${summaryLanguage}`);

  showLoading();
  hideError();
  hideSummary();
  summarizeBtn.disabled = true;

  try {
    const tabContents = await extractTabContents(selectedTabs);
    debugLog(`Extracted content from ${tabContents.length} tabs`);
    
    loadingText.textContent = 'Sending to AI for summarization...';
    debugLog('Sending request to ChatGPT API...');
    
    const summary = await chrome.runtime.sendMessage({
      action: 'summarize',
      contents: tabContents,
      tabCount: tabContents.length,
      language: summaryLanguage
    });

    if (summary.error) {
      debugLog(`Summarization error: ${summary.error}`, 'error');
      showError(summary.error);
    } else {
      debugLog('Successfully received summary from AI');
      showSummary(summary.text);
    }
  } catch (error) {
    debugLog(`Error during summarization: ${error.message}`, 'error');
    showError('Failed to summarize tabs. Please try again.');
  } finally {
    hideLoading();
    updateButtonsState();
  }
}

async function extractTabContents(tabs) {
  const contents = [];
  const totalTabs = tabs.length;

  for (let i = 0; i < totalTabs; i++) {
    const tab = tabs[i];
    updateProgress(i + 1, totalTabs);
    loadingText.textContent = `Extracting content from tab ${i + 1}/${totalTabs}...`;
    debugLog(`Extracting tab ${i + 1}/${totalTabs}: ${tab.title || 'Untitled'} (ID: ${tab.id})`);
    debugLog(`Tab URL: ${tab.url || 'N/A'}`);
    debugLog(`Tab status: ${tab.status || 'unknown'}, discarded: ${tab.discarded || false}`);

    try {
      if (isRestrictedUrl(tab.url)) {
        debugLog(`Tab ${i + 1} is restricted: ${tab.url}`, 'warn');
        contents.push({ title: tab.title, url: tab.url, content: '[Restricted page]' });
        continue;
      }

      // If tab is unloaded/discarded, reload it and wait for it to be ready
      let currentTab = tab;
      if (tab.status === 'unloaded' || tab.discarded) {
        debugLog(`Tab ${tab.id} is unloaded/discarded, reloading...`);
        await chrome.tabs.reload(tab.id);
        currentTab = await waitForTabReady(tab.id);
        debugLog(`Tab ${tab.id} reloaded, status: ${currentTab.status}`);
      }

      debugLog(`Injecting content.js into tab ${currentTab.id}...`);
      const results = await executeScriptWithTimeout(currentTab.id, ['content.js'], 15000);
      debugLog(`Script injection completed for tab ${currentTab.id}`);

      if (results && results[0] && results[0].result) {
        const contentLength = results[0].result.length;
        debugLog(`Tab ${i + 1} extracted: ${contentLength} characters`);
        contents.push({ title: currentTab.title, url: currentTab.url, content: results[0].result });
      } else {
        debugLog(`Tab ${i + 1} returned no content`, 'warn');
        contents.push({ title: currentTab.title, url: currentTab.url, content: '[No content extracted]' });
      }
    } catch (error) {
      debugLog(`Error extracting tab ${i + 1}: ${error.message}`, 'error');
      let errorMsg = `[Error: ${error.message}]`;
      if (error.message.includes('Cannot access contents')) {
        errorMsg = '[Access denied: Chrome blocked this page. Enable "On all sites" in extension Site Access settings.]';
      }
      contents.push({ title: tab.title, url: tab.url, content: errorMsg });
    }
  }

  return contents;
}

function waitForTabReady(tabId, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      chrome.tabs.get(tabId).then(resolve).catch(reject);
    }, timeout);

    function listener(updatedTabId, changeInfo, tab) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(tab);
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

function updateProgress(current, total) {
  const percentage = (current / total) * 100;
  progressFill.style.width = `${percentage}%`;
  progressText.textContent = `${current} / ${total} tabs processed`;
}

function showLoading() {
  loadingSection.classList.remove('hidden');
  progressFill.style.width = '0%';
  progressText.textContent = '0 / 0 tabs processed';
  loadingText.textContent = 'Extracting content from tabs...';
}

function hideLoading() { loadingSection.classList.add('hidden'); }
function showSummary(text) { summaryContent.textContent = text; summarySection.classList.remove('hidden'); }
function hideSummary() { summarySection.classList.add('hidden'); }
function showError(message) { errorMessage.textContent = message; errorSection.classList.remove('hidden'); debugLog(`Error: ${message}`, 'error'); }
function hideError() { errorSection.classList.add('hidden'); }

function isRestrictedUrl(url) {
  if (!url) return true;
  const restrictedPrefixes = ['chrome://', 'chrome-extension://', 'edge://', 'about:', 'file://', 'devtools://'];
  return restrictedPrefixes.some(prefix => url.startsWith(prefix));
}
