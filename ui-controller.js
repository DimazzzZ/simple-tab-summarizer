/**
 * Shared UI Controller for Tab Group Summarizer
 * 
 * Contains all common logic used by both popup.js and sidebar.js.
 * Each UI entrypoint creates a controller instance with its own DOM elements
 * and mode-toggle behavior.
 */

// Shared UI context key in chrome.storage.local
const SHARED_CONTEXT_KEY = 'shared_ui_context';
// Shared UI session key for persistent summary/error state
const SHARED_SESSION_KEY = 'shared_ui_session';

export class UIController {
  /**
   * @param {Object} dom - DOM element references
   * @param {Object} options - UI-specific options
   * @param {Function} options.onModeToggle - Called when mode toggle is clicked
   * @param {string} options.defaultModeLabel - Default label for mode toggle span
   */
  constructor(dom, options = {}) {
    this.dom = dom;
    this.onModeToggle = options.onModeToggle || null;
    this.defaultModeLabel = options.defaultModeLabel || 'Sidebar';

    // Unique instance ID for loop prevention
    this.instanceId = `ui_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // State
    this.selectedGroupId = null;
    this.groupTabs = [];
    this.readingListEntries = [];
    this.selectedTabIds = new Set();
    this.selectedReadingListIds = new Set();
    this.selectedReadingListUrls = new Set();
    this.isAuthenticated = false;
    this.allGroups = [];
    this.debugEnabled = false;
    this.currentSource = 'currentTab';

    // Shared context sync
    this._applyingSharedContext = false;
    this._saveContextTimer = null;
    this._storageListener = null;
  }

  // ============================================
  // Debug Logging
  // ============================================

  debugLog(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const entry = document.createElement('div');
    entry.className = `debug-entry debug-${type}`;
    entry.textContent = `[${timestamp}] ${message}`;
    if (this.debugEnabled && this.dom.debugConsole) {
      this.dom.debugConsole.appendChild(entry);
      this.dom.debugConsole.scrollTop = this.dom.debugConsole.scrollHeight;
    }
    console.log(`[TabGroupSummarizer] ${message}`);
  }

  // ============================================
  // Helpers
  // ============================================

  executeScriptWithTimeout(tabId, files, timeoutMs = 8000) {
    return Promise.race([
      chrome.scripting.executeScript({ target: { tabId }, files }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Script execution timed out after ${timeoutMs}ms`)), timeoutMs)
      )
    ]);
  }

  isRestrictedUrl(url) {
    if (!url) return true;
    const restrictedPrefixes = ['chrome://', 'chrome-extension://', 'edge://', 'about:', 'file://', 'devtools://'];
    return restrictedPrefixes.some(prefix => url.startsWith(prefix));
  }

  waitForTabReady(tabId, timeout = 30000) {
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

  // ============================================
  // Settings
  // ============================================

  async loadSettings() {
    const result = await chrome.storage.local.get(['debugEnabled', 'summaryLanguage']);
    this.debugEnabled = result.debugEnabled || false;
    this.dom.debugToggle.checked = this.debugEnabled;
    this.updateDebugVisibility();

    if (result.summaryLanguage) {
      this.dom.languageSelect.value = result.summaryLanguage;
    }

    await this.updateModeToggleLabel();
    await this.loadSharedContext();
    this.setupStorageListener();
  }

  // ============================================
  // Shared Context Sync
  // ============================================

  async loadSharedContext() {
    try {
      const result = await chrome.storage.local.get([SHARED_CONTEXT_KEY, SHARED_SESSION_KEY]);
      const ctx = result[SHARED_CONTEXT_KEY];
      if (ctx && ctx.source) {
        this._applySharedContext(ctx, true);
      }
      // Restore session state (summary/error)
      const session = result[SHARED_SESSION_KEY];
      if (session) {
        this._applySessionState(session);
      }
    } catch (e) {
      this.debugLog(`Failed to load shared context: ${e.message}`, 'error');
    }
  }

  _applySessionState(session) {
    if (session.summaryText) {
      this.dom.summaryContent.textContent = session.summaryText;
      this.dom.summarySection.classList.remove('hidden');
    }
    if (session.errorMessage) {
      this.dom.errorMessage.textContent = session.errorMessage;
      this.dom.errorSection.classList.remove('hidden');
    }
  }

  _saveSessionState() {
    if (this._sessionSaveTimer) {
      clearTimeout(this._sessionSaveTimer);
    }
    this._sessionSaveTimer = setTimeout(() => {
      this._doSaveSession();
    }, 100);
  }

  async _doSaveSession() {
    try {
      const session = {
        summaryText: this.dom.summaryContent.textContent || null,
        errorMessage: this.dom.errorMessage.textContent || null,
        updatedAt: Date.now(),
        updatedBy: this.instanceId
      };
      await chrome.storage.local.set({ [SHARED_SESSION_KEY]: session });
    } catch (e) {
      this.debugLog(`Failed to save session state: ${e.message}`, 'error');
    }
  }

  _applySharedContext(ctx, isInitialLoad = false) {
    if (ctx.updatedBy === this.instanceId) return; // ignore own updates

    this._applyingSharedContext = true;

    if (ctx.source && ctx.source !== this.currentSource) {
      this.currentSource = ctx.source;
      this.dom.sourceSelect.value = ctx.source;
      this._updateVisibilityForSource();
    }

    if (ctx.selectedGroupId !== undefined && ctx.selectedGroupId !== this.selectedGroupId) {
      this.selectedGroupId = ctx.selectedGroupId;
      if (this.selectedGroupId !== null) {
        this.dom.groupSelect.value = String(this.selectedGroupId);
        this._loadGroupTabsForId(this.selectedGroupId);
      }
    }

    if (ctx.selectedTabIds && Array.isArray(ctx.selectedTabIds)) {
      this.selectedTabIds = new Set(ctx.selectedTabIds);
      this._updateCheckboxesFromSelection();
    }

    if (ctx.selectedReadingListUrls && Array.isArray(ctx.selectedReadingListUrls)) {
      this.selectedReadingListUrls = new Set(ctx.selectedReadingListUrls);
      this._syncReadingListIdsFromUrls();
    }

    this._applyingSharedContext = false;

    if (!isInitialLoad) {
      this.updateButtonsState();
      this.debugLog('Applied shared context from another view');
    }
  }

  setupStorageListener() {
    this._storageListener = (changes, area) => {
      if (area === 'local' && changes[SHARED_CONTEXT_KEY]) {
        const ctx = changes[SHARED_CONTEXT_KEY].newValue;
        if (ctx) {
          this._applySharedContext(ctx);
        }
      }
    };
    chrome.storage.onChanged.addListener(this._storageListener);
  }

  removeStorageListener() {
    if (this._storageListener) {
      chrome.storage.onChanged.removeListener(this._storageListener);
    }
  }

  saveSharedContext() {
    if (this._saveContextTimer) {
      clearTimeout(this._saveContextTimer);
    }
    this._saveContextTimer = setTimeout(() => {
      this._doSaveContext();
    }, 150);
  }

  async _doSaveContext() {
    try {
      const ctx = {
        source: this.currentSource,
        selectedGroupId: this.selectedGroupId,
        selectedTabIds: Array.from(this.selectedTabIds),
        selectedReadingListUrls: Array.from(this.selectedReadingListUrls),
        updatedAt: Date.now(),
        updatedBy: this.instanceId
      };
      await chrome.storage.local.set({ [SHARED_CONTEXT_KEY]: ctx });
    } catch (e) {
      this.debugLog(`Failed to save shared context: ${e.message}`, 'error');
    }
  }

  async _loadGroupTabsForId(groupId) {
    try {
      const tabs = await chrome.tabs.query({ groupId });
      this.groupTabs = tabs;
      // Prune selected IDs that no longer exist
      const existingIds = new Set(tabs.map(t => t.id));
      for (const id of this.selectedTabIds) {
        if (!existingIds.has(id)) {
          this.selectedTabIds.delete(id);
        }
      }
      this.renderPagesList();
      this.updateButtonsState();
    } catch (e) {
      this.debugLog(`Error loading group tabs for ${groupId}: ${e.message}`, 'error');
    }
  }

  _updateCheckboxesFromSelection() {
    if (!this.dom.pagesList) return;
    this.dom.pagesList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.checked = this.selectedTabIds.has(parseInt(cb.value));
    });
  }

  _syncReadingListIdsFromUrls() {
    this.selectedReadingListIds.clear();
    this.readingListEntries.forEach((entry, index) => {
      if (this.selectedReadingListUrls.has(entry.url)) {
        this.selectedReadingListIds.add(index);
      }
    });
    if (this.dom.readinglistList) {
      this.dom.readinglistList.querySelectorAll('input[type="checkbox"]').forEach((cb, index) => {
        cb.checked = this.selectedReadingListIds.has(index);
      });
    }
  }

  _updateVisibilityForSource() {
    if (this.currentSource === 'currentTab') {
      this.dom.groupSection?.classList.add('hidden');
      this.dom.readinglistSection?.classList.add('hidden');
      this.dom.pagesSection?.classList.add('hidden');
    } else if (this.currentSource === 'tabGroup') {
      this.dom.groupSection?.classList.remove('hidden');
      this.dom.readinglistSection?.classList.add('hidden');
      this.dom.pagesSection?.classList.add('hidden');
    } else if (this.currentSource === 'readingList') {
      this.dom.groupSection?.classList.add('hidden');
      this.dom.pagesSection?.classList.add('hidden');
    }
  }

  async updateModeToggleLabel() {
    if (!this.dom.modeToggle) return;
    try {
      const response = await chrome.runtime.sendMessage({ action: 'get_display_mode' });
      const mode = response.mode || 'popup';
      const span = this.dom.modeToggle.querySelector('span');
      if (span) {
        span.textContent = mode === 'sidebar' ? 'Popup' : this.defaultModeLabel;
      }
      this.dom.modeToggle.title = mode === 'sidebar' ? 'Switch to Popup mode' : `Switch to ${this.defaultModeLabel} mode`;
    } catch {
      const span = this.dom.modeToggle.querySelector('span');
      if (span) span.textContent = this.defaultModeLabel;
    }
  }

  async saveSetting(key, value) {
    await chrome.storage.local.set({ [key]: value });
  }

  updateDebugVisibility() {
    if (this.debugEnabled) {
      this.dom.debugSection.classList.remove('hidden');
    } else {
      this.dom.debugSection.classList.add('hidden');
    }
  }

  // ============================================
  // Event Listeners
  // ============================================

  setupEventListeners() {
    const { dom } = this;

    if (dom.modeToggle) {
      dom.modeToggle.addEventListener('click', async () => {
        if (this.onModeToggle) {
          await this.onModeToggle();
        }
        await this.updateModeToggleLabel();
      });
    }

    dom.connectBtn.addEventListener('click', () => this.handleConnect());
    dom.disconnectBtn.addEventListener('click', () => this.handleDisconnect());
    dom.sourceSelect.addEventListener('change', () => this.handleSourceChange());
    dom.groupSelect.addEventListener('change', () => this.handleGroupSelect());
    dom.selectAllBtn.addEventListener('click', () => this.handleSelectAll());
    dom.deselectAllBtn.addEventListener('click', () => this.handleDeselectAll());
    if (dom.rlSelectAllBtn) dom.rlSelectAllBtn.addEventListener('click', () => this.handleSelectAll());
    if (dom.rlDeselectAllBtn) dom.rlDeselectAllBtn.addEventListener('click', () => this.handleDeselectAll());
    dom.summarizeBtn.addEventListener('click', () => this.handleSummarize());
    if (dom.copySummaryBtn) dom.copySummaryBtn.addEventListener('click', () => this.handleCopySummary());
    dom.clearDebugBtn.addEventListener('click', () => {
      dom.debugConsole.innerHTML = '';
      this.debugLog('Debug console cleared');
    });
    dom.debugToggle.addEventListener('change', async () => {
      this.debugEnabled = dom.debugToggle.checked;
      await this.saveSetting('debugEnabled', this.debugEnabled);
      this.updateDebugVisibility();
      this.debugLog(`Debug console ${this.debugEnabled ? 'enabled' : 'disabled'}`);
    });
    dom.languageSelect.addEventListener('change', async () => {
      await this.saveSetting('summaryLanguage', dom.languageSelect.value);
      this.debugLog(`Summary language changed to: ${dom.languageSelect.value}`);
    });

    // Setup tab lifecycle listeners for auto-refreshing the Select Pages list
    this.setupTabLifecycleListeners();
    // Setup reading list lifecycle listeners for auto-refreshing the Reading List
    this.setupReadingListLifecycleListeners();
  }

  // Reading list lifecycle listeners to keep Reading List in sync
  setupReadingListLifecycleListeners() {
    this.removeReadingListLifecycleListeners();

    this._onReadingListAdded = () => {
      if (this.currentSource === 'readingList') {
        this.debouncedRefreshReadingList();
      }
    };

    this._onReadingListRemoved = () => {
      if (this.currentSource === 'readingList') {
        this.debouncedRefreshReadingList();
      }
    };

    this._onReadingListUpdated = () => {
      if (this.currentSource === 'readingList') {
        this.debouncedRefreshReadingList();
      }
    };

    if (chrome.readingList?.onEntryAdded) {
      chrome.readingList.onEntryAdded.addListener(this._onReadingListAdded);
    }
    if (chrome.readingList?.onEntryRemoved) {
      chrome.readingList.onEntryRemoved.addListener(this._onReadingListRemoved);
    }
    if (chrome.readingList?.onEntryUpdated) {
      chrome.readingList.onEntryUpdated.addListener(this._onReadingListUpdated);
    }
  }

  removeReadingListLifecycleListeners() {
    if (this._onReadingListAdded && chrome.readingList?.onEntryAdded) {
      chrome.readingList.onEntryAdded.removeListener(this._onReadingListAdded);
    }
    if (this._onReadingListRemoved && chrome.readingList?.onEntryRemoved) {
      chrome.readingList.onEntryRemoved.removeListener(this._onReadingListRemoved);
    }
    if (this._onReadingListUpdated && chrome.readingList?.onEntryUpdated) {
      chrome.readingList.onEntryUpdated.removeListener(this._onReadingListUpdated);
    }
  }

  debouncedRefreshReadingList() {
    if (this._readingListRefreshTimer) {
      clearTimeout(this._readingListRefreshTimer);
    }
    this._readingListRefreshTimer = setTimeout(() => {
      this.refreshReadingListEntries();
    }, 200);
  }

  async refreshReadingListEntries() {
    if (!chrome.readingList) return;

    try {
      // Preserve selected URLs for stable selection across changes
      const selectedUrls = new Set(
        this.readingListEntries
          .filter((_, i) => this.selectedReadingListIds.has(i))
          .map(e => e.url)
      );

      const entries = await chrome.readingList.query({});
      this.readingListEntries = entries;

      // Rebuild selectedReadingListIds based on URLs that still exist
      this.selectedReadingListIds.clear();
      entries.forEach((entry, index) => {
        if (selectedUrls.has(entry.url)) {
          this.selectedReadingListIds.add(index);
          this.selectedReadingListUrls.add(entry.url);
        }
      });

      // Only re-render if we're still on reading list source
      if (this.currentSource === 'readingList') {
        this.renderReadingList();
      }
      this.updateButtonsState();
      this.saveSharedContext();

      this.debugLog(`Refreshed reading list: ${entries.length} entries`);
    } catch (error) {
      this.debugLog(`Error refreshing reading list: ${error.message}`, 'error');
    }
  }

  // Tab lifecycle listeners to keep Select Pages list in sync
  setupTabLifecycleListeners() {
    // Remove any existing listeners first (avoid duplicates across popup openings)
    this.removeTabLifecycleListeners();

    this._onTabRemoved = () => {
      if (this.currentSource === 'tabGroup' && this.selectedGroupId !== null) {
        this.debouncedRefreshSelectedGroup();
      }
    };

    this._onTabAttached = () => {
      if (this.currentSource === 'tabGroup' && this.selectedGroupId !== null) {
        this.debouncedRefreshSelectedGroup();
      }
    };

    this._onTabDetached = () => {
      if (this.currentSource === 'tabGroup' && this.selectedGroupId !== null) {
        this.debouncedRefreshSelectedGroup();
      }
    };

    this._onTabUpdated = (tabId, changeInfo) => {
      if (this.currentSource === 'tabGroup' && this.selectedGroupId !== null) {
        // Only refresh if groupId changed or URL/title changed for a tab in our group
        if (changeInfo.groupId !== undefined || changeInfo.url || changeInfo.title) {
          this.debouncedRefreshSelectedGroup();
        }
      }
    };

    chrome.tabs.onRemoved.addListener(this._onTabRemoved);
    chrome.tabs.onAttached.addListener(this._onTabAttached);
    chrome.tabs.onDetached.addListener(this._onTabDetached);
    chrome.tabs.onUpdated.addListener(this._onTabUpdated);
  }

  removeTabLifecycleListeners() {
    if (this._onTabRemoved) chrome.tabs.onRemoved.removeListener(this._onTabRemoved);
    if (this._onTabAttached) chrome.tabs.onAttached.removeListener(this._onTabAttached);
    if (this._onTabDetached) chrome.tabs.onDetached.removeListener(this._onTabDetached);
    if (this._onTabUpdated) chrome.tabs.onUpdated.removeListener(this._onTabUpdated);
  }

  // Debounced refresh to avoid multiple rapid calls
  debouncedRefreshSelectedGroup() {
    if (this._refreshTimer) {
      clearTimeout(this._refreshTimer);
    }
    this._refreshTimer = setTimeout(() => {
      this.refreshSelectedGroupTabs();
    }, 200);
  }

  async refreshSelectedGroupTabs() {
    if (this.selectedGroupId === null) return;

    try {
      const tabs = await chrome.tabs.query({ groupId: this.selectedGroupId });
      const oldTabIds = new Set(this.groupTabs.map(t => t.id));
      const newTabIds = new Set(tabs.map(t => t.id));

      this.groupTabs = tabs;

      // Remove selected IDs that no longer exist
      for (const id of this.selectedTabIds) {
        if (!newTabIds.has(id)) {
          this.selectedTabIds.delete(id);
        }
      }

      // Re-render the list
      this.renderPagesList();
      this.updateButtonsState();
      this.saveSharedContext();

      this.debugLog(`Refreshed group tabs: ${tabs.length} tabs (was ${oldTabIds.size})`);
    } catch (error) {
      this.debugLog(`Error refreshing group tabs: ${error.message}`, 'error');
    }
  }

  // ============================================
  // Auth
  // ============================================

  async checkAuthStatus() {
    try {
      this.debugLog('Checking auth status...');
      const response = await chrome.runtime.sendMessage({ action: 'check_auth' });
      this.isAuthenticated = response.authenticated;
      this.debugLog(`Auth status: ${this.isAuthenticated ? 'Connected' : 'Not connected'}`);
      this.updateAuthUI(this.isAuthenticated);
    } catch (error) {
      this.debugLog(`Auth check error: ${error.message}`, 'error');
      this.updateAuthUI(false);
    }
  }

  updateAuthUI(authenticated) {
    const { dom } = this;
    if (authenticated) {
      dom.authIcon.classList.remove('disconnected');
      dom.authIcon.classList.add('connected');
      dom.authIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
      dom.authText.textContent = 'Connected to ChatGPT';
      dom.connectBtn.classList.add('hidden');
      dom.disconnectBtn.classList.remove('hidden');
      this.updateButtonsState();
    } else {
      dom.authIcon.classList.remove('connected');
      dom.authIcon.classList.add('disconnected');
      dom.authIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';
      dom.authText.textContent = 'Not connected';
      dom.connectBtn.classList.remove('hidden');
      dom.disconnectBtn.classList.add('hidden');
      dom.summarizeBtn.disabled = true;
    }
  }

  updateButtonsState() {
    let hasSelection = false;
    if (this.currentSource === 'currentTab') {
      hasSelection = true;
    } else if (this.currentSource === 'tabGroup') {
      hasSelection = this.selectedTabIds.size > 0;
    } else if (this.currentSource === 'readingList') {
      hasSelection = this.selectedReadingListIds.size > 0;
    }
    this.dom.summarizeBtn.disabled = !this.isAuthenticated || !hasSelection;
    this.debugLog(`Buttons updated - Summarize: ${!this.dom.summarizeBtn.disabled}, Source: ${this.currentSource}, Selected: ${this.currentSource === 'tabGroup' ? this.selectedTabIds.size : this.currentSource === 'readingList' ? this.selectedReadingListIds.size : 'N/A (current tab)'}`);
  }

  async handleConnect() {
    this.debugLog('Attempting to connect to ChatGPT...');
    this.dom.connectBtn.disabled = true;
    this.setConnectBtnText('Connecting...');

    try {
      const result = await chrome.runtime.sendMessage({ action: 'connect' });

      if (result.error) {
        this.debugLog(`Connection error: ${result.error}`, 'error');
        this.showError(result.error);
        this.updateAuthUI(false);
      } else if (result.success) {
        this.debugLog(`Connected to ChatGPT: ${result.message || 'Success'}`);
        this.isAuthenticated = true;
        this.updateAuthUI(true);
        this.hideError();
      } else if (result.needsLogin) {
        this.debugLog('User needs to log in to ChatGPT');
        chrome.tabs.create({ url: 'https://chatgpt.com' });
        this.showError('Please log in to ChatGPT, then click Connect again.');
        this.updateAuthUI(false);
      } else {
        this.debugLog(`Connection failed: ${result.message}`, 'error');
        this.showError(result.message || 'Connection failed.');
        this.updateAuthUI(false);
      }
    } catch (error) {
      this.debugLog(`Connection error: ${error.message}`, 'error');
      this.showError('Failed to connect. Please try again.');
      this.updateAuthUI(false);
    } finally {
      this.dom.connectBtn.disabled = false;
      this.setConnectBtnText('Connect to ChatGPT');
    }
  }

  setConnectBtnText(text) {
    const btnTextEl = this.dom.connectBtn.querySelector('.btn-text');
    if (btnTextEl) {
      btnTextEl.textContent = text;
    } else {
      this.dom.connectBtn.textContent = text;
    }
  }

  async handleDisconnect() {
    this.debugLog('Disconnecting from ChatGPT...');
    try {
      await chrome.runtime.sendMessage({ action: 'disconnect' });
      this.isAuthenticated = false;
      this.updateAuthUI(false);
      this.hideError();
      this.hideSummary();
      this.debugLog('Disconnected from ChatGPT');
    } catch (error) {
      this.debugLog(`Disconnect error: ${error.message}`, 'error');
      this.showError('Failed to disconnect.');
    }
  }

  // ============================================
  // Tab Groups
  // ============================================

  async loadTabGroups() {
    try {
      this.debugLog('Loading tab groups...');
      this.allGroups = await chrome.tabGroups.query({});
      this.debugLog(`Found ${this.allGroups.length} tab groups`);

      if (this.allGroups.length === 0) {
        this.dom.groupSelect.classList.add('hidden');
        this.dom.noGroups.classList.remove('hidden');
        this.dom.pagesSection.classList.add('hidden');
        return;
      }

      this.dom.groupSelect.classList.remove('hidden');
      this.dom.noGroups.classList.add('hidden');
      this.dom.groupSelect.innerHTML = '<option value="">-- Select a group --</option>';

      const colorMap = {
        'grey': '#808080', 'blue': '#0066cc', 'red': '#dc3545',
        'yellow': '#ffc107', 'green': '#28a745', 'pink': '#e83e8c',
        'purple': '#6f42c1', 'cyan': '#17a2b8', 'orange': '#fd7e14'
      };

      for (const group of this.allGroups) {
        const tabs = await chrome.tabs.query({ groupId: group.id });
        const option = document.createElement('option');
        option.value = group.id;
        option.textContent = `${group.title || 'Untitled'} (${tabs.length} tab${tabs.length !== 1 ? 's' : ''})`;

        const groupColor = colorMap[group.color] || '#808080';
        option.style.borderLeft = `3px solid ${groupColor}`;
        option.style.paddingLeft = '8px';

        this.dom.groupSelect.appendChild(option);
        this.debugLog(`Group: "${group.title || 'Untitled'}" - ${tabs.length} tabs`);
      }
    } catch (error) {
      this.debugLog(`Error loading tab groups: ${error.message}`, 'error');
      this.showError('Failed to load tab groups.');
    }
  }

  handleGroupSelect() {
    const selectedValue = this.dom.groupSelect.value;

    if (!selectedValue) {
      this.selectedGroupId = null;
      this.groupTabs = [];
      this.selectedTabIds.clear();
      this.dom.pagesSection.classList.add('hidden');
      this.updateButtonsState();
      this.saveSharedContext();
      return;
    }

    this.selectedGroupId = parseInt(selectedValue);
    this.debugLog(`Selected group ID: ${this.selectedGroupId}`);

    chrome.tabs.query({ groupId: this.selectedGroupId }).then(tabs => {
      this.groupTabs = tabs;
      this.selectedTabIds = new Set(tabs.map(t => t.id));
      this.debugLog(`Loaded ${tabs.length} tabs in group`);
      this.renderPagesList();
      this.dom.pagesSection.classList.remove('hidden');
      this.updateButtonsState();
      this.hideSummary();
      this.hideError();
      this.saveSharedContext();
    }).catch(error => {
      this.debugLog(`Error loading group tabs: ${error.message}`, 'error');
      this.showError('Failed to load tabs for this group.');
    });
  }

  renderPagesList() {
    this.dom.pagesList.innerHTML = '';

    const fragment = document.createDocumentFragment();

    this.groupTabs.forEach(tab => {
      const item = document.createElement('div');
      item.className = 'page-item fade-in';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = tab.id;
      checkbox.checked = this.selectedTabIds.has(tab.id);
      checkbox.addEventListener('change', (e) => {
        if (e.target.checked) {
          this.selectedTabIds.add(tab.id);
        } else {
          this.selectedTabIds.delete(tab.id);
        }
        this.updateButtonsState();
        this.saveSharedContext();
        this.debugLog(`Tab selection changed: ${this.selectedTabIds.size} selected`);
      });

      const text = document.createElement('span');
      text.className = 'page-title';
      text.textContent = tab.title || 'Untitled';
      text.title = tab.url;

      const closeBtn = document.createElement('button');
      closeBtn.className = 'page-close-btn';
      closeBtn.innerHTML = '&times;';
      closeBtn.title = 'Close tab';
      closeBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          await chrome.tabs.remove(tab.id);
          this.debugLog(`Closed tab ${tab.id}`);
          this.selectedTabIds.delete(tab.id);
          this.groupTabs = this.groupTabs.filter(t => t.id !== tab.id);
          this.renderPagesList();
          this.updateButtonsState();
          this.saveSharedContext();
        } catch (err) {
          this.debugLog(`Failed to close tab ${tab.id}: ${err.message}`, 'error');
        }
      });

      item.appendChild(checkbox);
      item.appendChild(text);
      item.appendChild(closeBtn);
      fragment.appendChild(item);
    });

    this.dom.pagesList.appendChild(fragment);
    this.debugLog(`Rendered ${this.groupTabs.length} page checkboxes`);
  }

  // ============================================
  // Reading List
  // ============================================

  async loadReadingList() {
    try {
      this.debugLog('Loading reading list...');
      if (!chrome.readingList) {
        this.debugLog('Reading List API not available', 'error');
        this.showError('Reading List is not available in this browser.');
        this.dom.readinglistSection.classList.add('hidden');
        return;
      }

      const entries = await chrome.readingList.query({});
      this.readingListEntries = entries;
      this.debugLog(`Found ${entries.length} reading list entries`);

      if (entries.length === 0) {
        this.dom.readinglistList.innerHTML = '';
        this.dom.noReadinglist.classList.remove('hidden');
        this.dom.readinglistSection.classList.remove('hidden');
        return;
      }

      this.dom.noReadinglist.classList.add('hidden');
      this.renderReadingList();
      this.dom.readinglistSection.classList.remove('hidden');
    } catch (error) {
      this.debugLog(`Error loading reading list: ${error.message}`, 'error');
      this.showError('Failed to load reading list.');
    }
  }

  renderReadingList() {
    this.dom.readinglistList.innerHTML = '';

    const fragment = document.createDocumentFragment();

    this.readingListEntries.forEach((entry, index) => {
      const item = document.createElement('div');
      item.className = 'page-item fade-in';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = index;
      checkbox.checked = this.selectedReadingListIds.has(index);
      checkbox.addEventListener('change', (e) => {
        if (e.target.checked) {
          this.selectedReadingListIds.add(index);
          this.selectedReadingListUrls.add(this.readingListEntries[index].url);
        } else {
          this.selectedReadingListIds.delete(index);
          this.selectedReadingListUrls.delete(this.readingListEntries[index].url);
        }
        this.updateButtonsState();
        this.saveSharedContext();
        this.debugLog(`Reading list selection changed: ${this.selectedReadingListIds.size} selected`);
      });

      const text = document.createElement('span');
      text.className = 'page-title';
      text.textContent = entry.title || entry.url;
      text.title = entry.url;

      const closeBtn = document.createElement('button');
      closeBtn.className = 'page-close-btn';
      closeBtn.innerHTML = '&times;';
      closeBtn.title = 'Remove from reading list';
      closeBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          await chrome.readingList.removeEntry({ url: entry.url });
          this.debugLog(`Removed reading list entry: ${entry.url}`);
          this.selectedReadingListIds.delete(index);
          this.selectedReadingListUrls.delete(entry.url);
          this.readingListEntries = this.readingListEntries.filter(en => en.url !== entry.url);
          this.renderReadingList();
          this.updateButtonsState();
          this.saveSharedContext();
        } catch (err) {
          this.debugLog(`Failed to remove reading list entry: ${err.message}`, 'error');
        }
      });

      item.appendChild(checkbox);
      item.appendChild(text);
      item.appendChild(closeBtn);
      fragment.appendChild(item);
    });

    this.dom.readinglistList.appendChild(fragment);
    this.debugLog(`Rendered ${this.readingListEntries.length} reading list checkboxes`);
  }

  // ============================================
  // Selection Helpers
  // ============================================

  handleSelectAll() {
    if (this.currentSource === 'tabGroup') {
      this.selectedTabIds = new Set(this.groupTabs.map(t => t.id));
      this.dom.pagesList.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
      this.debugLog(`Selected all ${this.selectedTabIds.size} tabs`);
    } else if (this.currentSource === 'readingList') {
      this.selectedReadingListIds = new Set(this.readingListEntries.map((_, i) => i));
      this.selectedReadingListUrls = new Set(this.readingListEntries.map(e => e.url));
      this.dom.readinglistList.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
      this.debugLog(`Selected all ${this.selectedReadingListIds.size} reading list entries`);
    }
    this.updateButtonsState();
    this.saveSharedContext();
  }

  handleDeselectAll() {
    if (this.currentSource === 'tabGroup') {
      this.selectedTabIds.clear();
      this.dom.pagesList.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
      this.debugLog('Deselected all tabs');
    } else if (this.currentSource === 'readingList') {
      this.selectedReadingListIds.clear();
      this.selectedReadingListUrls.clear();
      this.dom.readinglistList.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
      this.debugLog('Deselected all reading list entries');
    }
    this.updateButtonsState();
    this.saveSharedContext();
  }

  // ============================================
  // Source Change
  // ============================================

  handleSourceChange() {
    this.currentSource = this.dom.sourceSelect.value;
    this.debugLog(`Source changed to: ${this.currentSource}`);

    this.selectedTabIds.clear();
    this.selectedReadingListIds.clear();
    this.selectedReadingListUrls.clear();
    this.hideSummary();
    this.hideError();

    if (this.currentSource === 'currentTab') {
      this.dom.groupSection.classList.add('hidden');
      this.dom.readinglistSection.classList.add('hidden');
      this.dom.pagesSection.classList.add('hidden');
      this.updateButtonsState();
    } else if (this.currentSource === 'tabGroup') {
      this.dom.groupSection.classList.remove('hidden');
      this.dom.readinglistSection.classList.add('hidden');
      this.dom.pagesSection.classList.add('hidden');
      this.updateButtonsState();
    } else if (this.currentSource === 'readingList') {
      this.dom.groupSection.classList.add('hidden');
      this.dom.pagesSection.classList.add('hidden');
      this.loadReadingList();
    }
    this.saveSharedContext();
  }

  // ============================================
  // Copy Summary
  // ============================================

  async handleCopySummary() {
    const text = this.dom.summaryContent.textContent;
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      const originalText = this.dom.copySummaryBtn.innerHTML;
      this.dom.copySummaryBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Copied!';
      setTimeout(() => {
        this.dom.copySummaryBtn.innerHTML = originalText;
      }, 2000);
      this.debugLog('Summary copied to clipboard');
    } catch (error) {
      this.debugLog(`Failed to copy: ${error.message}`, 'error');
    }
  }

  // ============================================
  // Summarize
  // ============================================

  async handleSummarize() {
    let itemCount = 0;
    if (this.currentSource === 'currentTab') {
      itemCount = 1;
    } else if (this.currentSource === 'tabGroup') {
      itemCount = this.selectedTabIds.size;
    } else if (this.currentSource === 'readingList') {
      itemCount = this.selectedReadingListIds.size;
    }

    if (itemCount === 0) {
      this.showError('No items selected.');
      return;
    }

    if (!this.isAuthenticated) {
      this.showError('Please connect to ChatGPT first.');
      return;
    }

    const summaryLanguage = this.dom.languageSelect.value || 'English';
    this.debugLog(`Starting summarization for ${itemCount} ${this.currentSource} items in ${summaryLanguage}`);

    this.showLoading();
    this.hideError();
    this.hideSummary();
    this.dom.summarizeBtn.disabled = true;

    try {
      let contents = [];
      if (this.currentSource === 'currentTab') {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!activeTab) {
          this.showError('No active tab found.');
          return;
        }
        this.debugLog(`Summarizing current tab: ${activeTab.title || 'Untitled'}`);
        contents = await this.extractTabContents([activeTab]);
      } else if (this.currentSource === 'tabGroup') {
        const selectedTabs = this.groupTabs.filter(t => this.selectedTabIds.has(t.id));
        contents = await this.extractTabContents(selectedTabs);
      } else if (this.currentSource === 'readingList') {
        contents = await this.extractReadingListContents();
      }

      this.debugLog(`Extracted content from ${contents.length} items`);

      this.dom.loadingText.textContent = 'Sending to AI for summarization...';
      this.debugLog('Sending request to ChatGPT API...');

      const summary = await chrome.runtime.sendMessage({
        action: 'summarize',
        contents: contents,
        tabCount: contents.length,
        language: summaryLanguage
      });

      if (summary.error) {
        this.debugLog(`Summarization error: ${summary.error}`, 'error');
        this.showError(summary.error);
      } else {
        this.debugLog('Successfully received summary from AI');
        this.showSummary(summary.text);
      }
    } catch (error) {
      this.debugLog(`Error during summarization: ${error.message}`, 'error');
      this.showError('Failed to summarize. Please try again.');
    } finally {
      this.hideLoading();
      this.updateButtonsState();
    }
  }

  // ============================================
  // Extraction
  // ============================================

  async extractTabContents(tabs) {
    const contents = new Array(tabs.length);
    const totalTabs = tabs.length;
    const CONCURRENCY = 2;
    let completed = 0;

    const extractSingleTab = async (index, tab) => {
      this.debugLog(`Extracting tab ${index + 1}/${totalTabs}: ${tab.title || 'Untitled'} (ID: ${tab.id})`);
      this.debugLog(`Tab URL: ${tab.url || 'N/A'}`);
      this.debugLog(`Tab status: ${tab.status || 'unknown'}, discarded: ${tab.discarded || false}`);

      let currentTab = tab;

      try {
        if (this.isRestrictedUrl(tab.url)) {
          this.debugLog(`Tab ${index + 1} is restricted: ${tab.url}`, 'warn');
          contents[index] = { title: tab.title, url: tab.url, content: '[Restricted page]' };
          return;
        }

        if (tab.status === 'unloaded' || tab.discarded) {
          this.debugLog(`Tab ${tab.id} is unloaded/discarded, reloading...`);
          await chrome.tabs.reload(tab.id);
          currentTab = await this.waitForTabReady(tab.id);
          this.debugLog(`Tab ${tab.id} reloaded, status: ${currentTab.status}`);
        }

        this.debugLog(`Injecting content.js into tab ${currentTab.id}...`);
        const results = await this.executeScriptWithTimeout(currentTab.id, ['content.js'], 8000);
        this.debugLog(`Script injection completed for tab ${currentTab.id}`);

        if (results && results[0] && results[0].result) {
          const contentLength = results[0].result.length;
          this.debugLog(`Tab ${index + 1} extracted: ${contentLength} characters`);
          contents[index] = { title: currentTab.title, url: currentTab.url, content: results[0].result };
        } else {
          this.debugLog(`Tab ${index + 1} returned no content`, 'warn');
          contents[index] = { title: currentTab.title, url: currentTab.url, content: '[No content extracted]' };
        }
      } catch (error) {
        this.debugLog(`Error extracting tab ${index + 1}: ${error.message}`, 'error');
        if (error.message.includes('Cannot access contents')) {
          contents[index] = { title: tab.title, url: tab.url, content: '[Access denied: Chrome blocked this page. Enable "On all sites" in extension Site Access settings.]' };
        } else {
          const fallbackContent = `[Page extraction timed out. Title: ${tab.title || 'N/A'}]`;
          this.debugLog(`Using metadata fallback for tab ${index + 1}`);
          contents[index] = { title: tab.title, url: tab.url, content: fallbackContent };
        }
      } finally {
        completed++;
        this.updateProgress(completed, totalTabs);
        this.dom.loadingText.textContent = `Extracting content from tab ${completed}/${totalTabs}...`;
      }
    };

    for (let i = 0; i < totalTabs; i += CONCURRENCY) {
      const batch = tabs.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map((tab, j) => extractSingleTab(i + j, tab)));
    }

    return contents.filter(c => c !== undefined);
  }

  async extractReadingListContents() {
    const contents = [];
    const selectedEntries = this.readingListEntries.filter((_, i) => this.selectedReadingListIds.has(i));
    const totalItems = selectedEntries.length;

    for (let i = 0; i < totalItems; i++) {
      const entry = selectedEntries[i];
      this.updateProgress(i + 1, totalItems);
      this.dom.loadingText.textContent = `Extracting content from page ${i + 1}/${totalItems}...`;
      this.debugLog(`Extracting reading list entry ${i + 1}/${totalItems}: ${entry.title || 'Untitled'} (${entry.url})`);

      try {
        if (this.isRestrictedUrl(entry.url)) {
          this.debugLog(`Entry ${i + 1} is restricted: ${entry.url}`, 'warn');
          contents.push({ title: entry.title || 'Untitled', url: entry.url, content: '[Restricted page]' });
          continue;
        }

        this.debugLog(`Opening ${entry.url} in background tab...`);
        const tempTab = await chrome.tabs.create({ url: entry.url, active: false });

        const readyTab = await this.waitForTabReady(tempTab.id, 15000);
        this.debugLog(`Tab ${readyTab.id} ready, status: ${readyTab.status}`);

        this.debugLog(`Injecting content.js into tab ${readyTab.id}...`);
        const results = await this.executeScriptWithTimeout(readyTab.id, ['content.js'], 15000);
        this.debugLog(`Script injection completed for tab ${readyTab.id}`);

        try { await chrome.tabs.remove(readyTab.id); } catch {}
        this.debugLog(`Closed temp tab ${readyTab.id}`);

        if (results && results[0] && results[0].result) {
          const contentLength = results[0].result.length;
          this.debugLog(`Entry ${i + 1} extracted: ${contentLength} characters`);
          contents.push({ title: entry.title || 'Untitled', url: entry.url, content: results[0].result });
        } else {
          this.debugLog(`Entry ${i + 1} returned no content`, 'warn');
          contents.push({ title: entry.title || 'Untitled', url: entry.url, content: '[No content extracted]' });
        }
      } catch (error) {
        this.debugLog(`Error extracting entry ${i + 1}: ${error.message}`, 'error');
        let errorMsg = `[Error: ${error.message}]`;
        if (error.message.includes('Cannot access contents')) {
          errorMsg = '[Access denied: Chrome blocked this page.]';
        }
        contents.push({ title: entry.title || 'Untitled', url: entry.url, content: errorMsg });
      }
    }

    return contents;
  }

  // ============================================
  // UI State
  // ============================================

  updateProgress(current, total) {
    const percentage = (current / total) * 100;
    this.dom.progressFill.style.width = `${percentage}%`;
    this.dom.progressText.textContent = `${current} / ${total} tabs processed`;
  }

  showLoading() {
    this.dom.loadingSection.classList.remove('hidden');
    this.dom.progressFill.style.width = '0%';
    this.dom.progressText.textContent = '0 / 0 tabs processed';
    this.dom.loadingText.textContent = 'Extracting content from tabs...';
  }

  hideLoading() { this.dom.loadingSection.classList.add('hidden'); }

  showSummary(text) {
    this.dom.summaryContent.textContent = text;
    this.dom.summarySection.classList.remove('hidden');
    this._saveSessionState();
  }

  hideSummary() {
    this.dom.summarySection.classList.add('hidden');
    this._saveSessionState();
  }

  showError(message) {
    this.dom.errorMessage.textContent = message;
    this.dom.errorSection.classList.remove('hidden');
    this.debugLog(`Error: ${message}`, 'error');
    this._saveSessionState();
  }

  hideError() {
    this.dom.errorSection.classList.add('hidden');
    this._saveSessionState();
  }
}
