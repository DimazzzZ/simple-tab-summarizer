// Popup entrypoint — thin wrapper around shared UIController
import './ui-controller.js';

document.addEventListener('DOMContentLoaded', async () => {
  const dom = {
    modeToggle: document.getElementById('mode-toggle'),
    authIcon: document.getElementById('auth-icon'),
    authText: document.getElementById('auth-text'),
    connectBtn: document.getElementById('connect-btn'),
    disconnectBtn: document.getElementById('disconnect-btn'),
    sourceSelect: document.getElementById('source-select'),
    groupSection: document.getElementById('group-section'),
    groupSelect: document.getElementById('group-select'),
    noGroups: document.getElementById('no-groups'),
    readinglistSection: document.getElementById('readinglist-section'),
    readinglistList: document.getElementById('readinglist-list'),
    noReadinglist: document.getElementById('no-readinglist'),
    pagesSection: document.getElementById('pages-section'),
    pagesList: document.getElementById('pages-list'),
    selectAllBtn: document.getElementById('select-all-btn'),
    deselectAllBtn: document.getElementById('deselect-all-btn'),
    rlSelectAllBtn: document.getElementById('rl-select-all-btn'),
    rlDeselectAllBtn: document.getElementById('rl-deselect-all-btn'),
    languageSelect: document.getElementById('language-select'),
    summarizeBtn: document.getElementById('summarize-btn'),
    debugConsole: document.getElementById('debug-console'),
    debugSection: document.getElementById('debug-section'),
    debugToggle: document.getElementById('debug-toggle'),
    clearDebugBtn: document.getElementById('clear-debug-btn'),
    loadingSection: document.getElementById('loading-section'),
    loadingText: document.getElementById('loading-text'),
    progressFill: document.getElementById('progress-fill'),
    progressText: document.getElementById('progress-text'),
    summarySection: document.getElementById('summary-section'),
    summaryContent: document.getElementById('summary-content'),
    copySummaryBtn: document.getElementById('copy-summary-btn'),
    errorSection: document.getElementById('error-section'),
    errorMessage: document.getElementById('error-message')
  };

  const controller = new UIController(dom, {
    defaultModeLabel: 'Sidebar',
    onModeToggle: async () => {
      await chrome.runtime.sendMessage({ action: 'set_display_mode', mode: 'sidebar' });
      chrome.sidePanel.open({ windowId: chrome.windows.WINDOW_ID_CURRENT });
    }
  });

  await controller.loadSettings();
  await controller.checkAuthStatus();
  await controller.loadTabGroups();
  controller.setupEventListeners();
});
