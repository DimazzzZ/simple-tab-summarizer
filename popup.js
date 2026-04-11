// DOM Elements
const modeToggle = document.getElementById('mode-toggle');
const authIcon = document.getElementById('auth-icon');
const authText = document.getElementById('auth-text');
const connectBtn = document.getElementById('connect-btn');
const disconnectBtn = document.getElementById('disconnect-btn');
const sourceSelect = document.getElementById('source-select');
const groupSection = document.getElementById('group-section');
const groupSelect = document.getElementById('group-select');
const noGroups = document.getElementById('no-groups');
const readinglistSection = document.getElementById('readinglist-section');
const readinglistList = document.getElementById('readinglist-list');
const noReadinglist = document.getElementById('no-readinglist');
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
let readingListEntries = [];
let selectedTabIds = new Set();
let selectedReadingListIds = new Set();
let isAuthenticated = false;
let allGroups = [];
let debugEnabled = false;
let currentSource = 'tabGroup';

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
  
  // Update mode toggle button label
  await updateModeToggleLabel();
}

async function updateModeToggleLabel() {
  if (!modeToggle) return;
  try {
    const response = await chrome.runtime.sendMessage({ action: 'get_display_mode' });
    const mode = response.mode || 'popup';
    modeToggle.textContent = mode === 'sidebar' ? '📌 Popup' : '📌 Sidebar';
    modeToggle.title = mode === 'sidebar' ? 'Switch to Popup mode' : 'Switch to Sidebar mode';
  } catch {
    modeToggle.textContent = '📌 Sidebar';
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
  if (modeToggle) {
    modeToggle.addEventListener('click', async () => {
      // Switch to sidebar mode
      await chrome.runtime.sendMessage({ action: 'set_display_mode', mode: 'sidebar' });
      // Update label
      modeToggle.textContent = '📌 Popup';
      modeToggle.title = 'Switch to Popup mode';
      // Open the side panel
      chrome.sidePanel.open({ windowId: chrome.windows.WINDOW_ID_CURRENT });
    });
  }
  connectBtn.addEventListener('click', handleConnect);
  disconnectBtn.addEventListener('click', handleDisconnect);
  sourceSelect.addEventListener('change', handleSourceChange);
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

async function handleSourceChange() {
  currentSource = sourceSelect.value;
  debugLog(`Source changed to: ${currentSource}`);
  
  // Reset selections
  selectedTabIds.clear();
  selectedReadingListIds.clear();
  hideSummary();
  hideError();
  
  if (currentSource === 'tabGroup') {
    groupSection.classList.remove('hidden');
    readinglistSection.classList.add('hidden');
    pagesSection.classList.add('hidden');
    updateButtonsState();
  } else if (currentSource === 'readingList') {
    groupSection.classList.add('hidden');
    await loadReadingList();
  }
}

async function loadReadingList() {
  try {
    debugLog('Loading reading list...');
    if (!chrome.readingList) {
      debugLog('Reading List API not available', 'error');
      showError('Reading List is not available in this browser.');
      readinglistSection.classList.add('hidden');
      return;
    }
    
    const entries = await chrome.readingList.query({});
    readingListEntries = entries;
    debugLog(`Found ${entries.length} reading list entries`);
    
    if (entries.length === 0) {
      readinglistList.innerHTML = '';
      noReadinglist.classList.remove('hidden');
      readinglistSection.classList.remove('hidden');
      return;
    }
    
    noReadinglist.classList.add('hidden');
    renderReadingList();
    readinglistSection.classList.remove('hidden');
  } catch (error) {
    debugLog(`Error loading reading list: ${error.message}`, 'error');
    showError('Failed to load reading list.');
  }
}

function renderReadingList() {
  readinglistList.innerHTML = '';
  
  readingListEntries.forEach((entry, index) => {
    const item = document.createElement('label');
    item.className = 'page-item';
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = index;
    checkbox.checked = selectedReadingListIds.has(index);
    checkbox.addEventListener('change', (e) => {
      if (e.target.checked) {
        selectedReadingListIds.add(index);
      } else {
        selectedReadingListIds.delete(index);
      }
      updateButtonsState();
      debugLog(`Reading list selection changed: ${selectedReadingListIds.size} selected`);
    });
    
    const text = document.createElement('span');
    text.className = 'page-title';
    text.textContent = entry.title || entry.url;
    text.title = entry.url;
    
    item.appendChild(checkbox);
    item.appendChild(text);
    readinglistList.appendChild(item);
  });
  
  debugLog(`Rendered ${readingListEntries.length} reading list checkboxes`);
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
  let hasSelection = false;
  if (currentSource === 'tabGroup') {
    hasSelection = selectedTabIds.size > 0;
  } else if (currentSource === 'readingList') {
    hasSelection = selectedReadingListIds.size > 0;
  }
  summarizeBtn.disabled = !isAuthenticated || !hasSelection;
  debugLog(`Buttons updated - Summarize: ${!summarizeBtn.disabled}, Selected: ${currentSource === 'tabGroup' ? selectedTabIds.size : selectedReadingListIds.size}`);
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
  if (currentSource === 'tabGroup') {
    selectedTabIds = new Set(groupTabs.map(t => t.id));
    pagesList.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
    debugLog(`Selected all ${selectedTabIds.size} tabs`);
  } else if (currentSource === 'readingList') {
    selectedReadingListIds = new Set(readingListEntries.map((_, i) => i));
    readinglistList.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
    debugLog(`Selected all ${selectedReadingListIds.size} reading list entries`);
  }
  updateButtonsState();
}

function handleDeselectAll() {
  if (currentSource === 'tabGroup') {
    selectedTabIds.clear();
    pagesList.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
    debugLog('Deselected all tabs');
  } else if (currentSource === 'readingList') {
    selectedReadingListIds.clear();
    readinglistList.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
    debugLog('Deselected all reading list entries');
  }
  updateButtonsState();
}

async function handleSummarize() {
  let itemCount = 0;
  if (currentSource === 'tabGroup') {
    itemCount = selectedTabIds.size;
  } else if (currentSource === 'readingList') {
    itemCount = selectedReadingListIds.size;
  }

  if (itemCount === 0) {
    showError('No items selected.');
    return;
  }

  if (!isAuthenticated) {
    showError('Please connect to ChatGPT first.');
    return;
  }

  const summaryLanguage = languageSelect.value || 'English';
  debugLog(`Starting summarization for ${itemCount} ${currentSource} items in ${summaryLanguage}`);

  showLoading();
  hideError();
  hideSummary();
  summarizeBtn.disabled = true;

  try {
    let contents = [];
    if (currentSource === 'tabGroup') {
      const selectedTabs = groupTabs.filter(t => selectedTabIds.has(t.id));
      contents = await extractTabContents(selectedTabs);
    } else if (currentSource === 'readingList') {
      contents = await extractReadingListContents();
    }
    
    debugLog(`Extracted content from ${contents.length} items`);
    
    loadingText.textContent = 'Sending to AI for summarization...';
    debugLog('Sending request to ChatGPT API...');
    
    const summary = await chrome.runtime.sendMessage({
      action: 'summarize',
      contents: contents,
      tabCount: contents.length,
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
    showError('Failed to summarize. Please try again.');
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

async function extractReadingListContents() {
  const contents = [];
  const selectedEntries = readingListEntries.filter((_, i) => selectedReadingListIds.has(i));
  const totalItems = selectedEntries.length;

  for (let i = 0; i < totalItems; i++) {
    const entry = selectedEntries[i];
    updateProgress(i + 1, totalItems);
    loadingText.textContent = `Extracting content from page ${i + 1}/${totalItems}...`;
    debugLog(`Extracting reading list entry ${i + 1}/${totalItems}: ${entry.title || 'Untitled'} (${entry.url})`);

    try {
      if (isRestrictedUrl(entry.url)) {
        debugLog(`Entry ${i + 1} is restricted: ${entry.url}`, 'warn');
        contents.push({ title: entry.title || 'Untitled', url: entry.url, content: '[Restricted page]' });
        continue;
      }

      // Open URL in a background tab
      debugLog(`Opening ${entry.url} in background tab...`);
      const tempTab = await chrome.tabs.create({ url: entry.url, active: false });
      
      // Wait for tab to be ready
      const readyTab = await waitForTabReady(tempTab.id, 15000);
      debugLog(`Tab ${readyTab.id} ready, status: ${readyTab.status}`);

      // Inject content script
      debugLog(`Injecting content.js into tab ${readyTab.id}...`);
      const results = await executeScriptWithTimeout(readyTab.id, ['content.js'], 15000);
      debugLog(`Script injection completed for tab ${readyTab.id}`);

      // Close the temp tab
      try { await chrome.tabs.remove(readyTab.id); } catch {}
      debugLog(`Closed temp tab ${readyTab.id}`);

      if (results && results[0] && results[0].result) {
        const contentLength = results[0].result.length;
        debugLog(`Entry ${i + 1} extracted: ${contentLength} characters`);
        contents.push({ title: entry.title || 'Untitled', url: entry.url, content: results[0].result });
      } else {
        debugLog(`Entry ${i + 1} returned no content`, 'warn');
        contents.push({ title: entry.title || 'Untitled', url: entry.url, content: '[No content extracted]' });
      }
    } catch (error) {
      debugLog(`Error extracting entry ${i + 1}: ${error.message}`, 'error');
      let errorMsg = `[Error: ${error.message}]`;
      if (error.message.includes('Cannot access contents')) {
        errorMsg = '[Access denied: Chrome blocked this page.]';
      }
      contents.push({ title: entry.title || 'Untitled', url: entry.url, content: errorMsg });
    }
  }

  return contents;
}

function isRestrictedUrl(url) {
  if (!url) return true;
  const restrictedPrefixes = ['chrome://', 'chrome-extension://', 'edge://', 'about:', 'file://', 'devtools://'];
  return restrictedPrefixes.some(prefix => url.startsWith(prefix));
}
