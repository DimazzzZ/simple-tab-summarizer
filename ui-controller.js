/**
 * Shared UI Controller for Tab Group Summarizer
 * 
 * Thin coordinator that delegates to extracted modules.
 * Each UI entrypoint (popup.js/sidebar.js) creates an instance with its own DOM.
 */

import { SourceType, Timings } from './constants/ui-keys.js';
import { createDebounce } from './utils/debounce.js';
import { loadState, saveContext, saveSession, subscribe } from './sync/storage-sync.js';
import { renderPagesList, renderReadingList } from './render/list-renderer.js';
import { showLoading, hideLoading, updateProgress, showSummary, hideSummary, showError, hideError } from './render/ui-feedback.js';
import { checkAuthStatus, updateAuthUI, handleConnect, handleDisconnect } from './features/auth.js';
import { loadTabGroups, handleGroupSelect } from './features/tab-groups.js';
import { loadReadingList, removeReadingListEntry, refreshReadingList } from './features/reading-list.js';
import { handleSummarize } from './features/summarize.js';
import { setupTabLifecycleListeners, setupReadingListLifecycleListeners } from './lifecycle/listeners.js';

export class UIController {
  constructor(dom, options = {}) {
    this.dom = dom;
    this.onModeToggle = options.onModeToggle || null;
    this.defaultModeLabel = options.defaultModeLabel || 'Sidebar';
    this.instanceId = `ui_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.selectedGroupId = null;
    this.groupTabs = [];
    this.readingListEntries = [];
    this.selectedTabIds = new Set();
    this.selectedReadingListIds = new Set();
    this.selectedReadingListUrls = new Set();
    this.isAuthenticated = false;
    this.allGroups = [];
    this.debugEnabled = false;
    this.currentSource = SourceType.CURRENT_TAB;
    this._storageUnsubscribe = null;
    this._tabCleanup = null;
    this._readingListCleanup = null;
    this._rlRefresh = null;
    this._refreshTimer = null;
  }

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

  async loadSettings() {
    const result = await chrome.storage.local.get(['debugEnabled', 'summaryLanguage', 'summaryLevel']);
    this.debugEnabled = result.debugEnabled || false;
    this.dom.debugToggle.checked = this.debugEnabled;
    this.updateDebugVisibility();
    if (result.summaryLanguage) this.dom.languageSelect.value = result.summaryLanguage;
    if (result.summaryLevel) this.dom.summaryLevelSelect.value = result.summaryLevel;
    await this.updateModeToggleLabel();
    await this.loadSharedContext();
    this.setupStorageListener();
  }

  async loadSharedContext() {
    const { context, session } = await loadState();
    if (context?.source) this._applySharedContext(context, true);
    if (session) this._applySessionState(session);
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

  _saveSessionState() { saveSession(this.dom, this.instanceId); }

  _applySharedContext(ctx, isInitialLoad = false) {
    if (ctx.updatedBy === this.instanceId) return;
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
    if (!isInitialLoad) { this.updateButtonsState(); this.debugLog('Applied shared context from another view'); }
  }

  setupStorageListener() { this._storageUnsubscribe = subscribe((ctx) => this._applySharedContext(ctx), this.instanceId); }
  removeStorageListener() { if (this._storageUnsubscribe) this._storageUnsubscribe(); }

  saveSharedContext() {
    saveContext({ source: this.currentSource, selectedGroupId: this.selectedGroupId, selectedTabIds: Array.from(this.selectedTabIds), selectedReadingListUrls: Array.from(this.selectedReadingListUrls) }, this.instanceId);
  }

  async _loadGroupTabsForId(groupId) {
    const tabs = await chrome.tabs.query({ groupId }).catch(() => []);
    this.groupTabs = tabs;
    const existingIds = new Set(tabs.map(t => t.id));
    for (const id of this.selectedTabIds) { if (!existingIds.has(id)) this.selectedTabIds.delete(id); }
    this._renderPagesList();
    this.updateButtonsState();
  }

  _updateCheckboxesFromSelection() {
    if (!this.dom.pagesList) return;
    this.dom.pagesList.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = this.selectedTabIds.has(parseInt(cb.value)); });
  }

  _syncReadingListIdsFromUrls() {
    this.selectedReadingListIds.clear();
    this.readingListEntries.forEach((entry, index) => { if (this.selectedReadingListUrls.has(entry.url)) this.selectedReadingListIds.add(index); });
    if (this.dom.readinglistList) { this.dom.readinglistList.querySelectorAll('input[type="checkbox"]').forEach((cb, index) => { cb.checked = this.selectedReadingListIds.has(index); }); }
  }

  _updateVisibilityForSource() {
    const { dom } = this;
    if (this.currentSource === SourceType.CURRENT_TAB) { dom.groupSection?.classList.add('hidden'); dom.readinglistSection?.classList.add('hidden'); dom.pagesSection?.classList.add('hidden'); }
    else if (this.currentSource === SourceType.TAB_GROUP) { dom.groupSection?.classList.remove('hidden'); dom.readinglistSection?.classList.add('hidden'); dom.pagesSection?.classList.add('hidden'); }
    else if (this.currentSource === SourceType.READING_LIST) { dom.groupSection?.classList.add('hidden'); dom.pagesSection?.classList.add('hidden'); }
  }

  async updateModeToggleLabel() {
    if (!this.dom.modeToggle) return;
    try {
      const response = await chrome.runtime.sendMessage({ action: 'get_display_mode' });
      const mode = response.mode || 'popup';
      const span = this.dom.modeToggle.querySelector('span');
      if (span) span.textContent = mode === 'sidebar' ? 'Popup' : this.defaultModeLabel;
      this.dom.modeToggle.title = mode === 'sidebar' ? 'Switch to Popup mode' : `Switch to ${this.defaultModeLabel} mode`;
    } catch { const span = this.dom.modeToggle.querySelector('span'); if (span) span.textContent = this.defaultModeLabel; }
  }

  async saveSetting(key, value) { await chrome.storage.local.set({ [key]: value }); }
  updateDebugVisibility() { this.dom.debugSection.classList.toggle('hidden', !this.debugEnabled); }

  setupEventListeners() {
    const { dom } = this;
    if (dom.modeToggle) dom.modeToggle.addEventListener('click', async () => { if (this.onModeToggle) await this.onModeToggle(); await this.updateModeToggleLabel(); });
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
    dom.clearDebugBtn.addEventListener('click', () => { dom.debugConsole.innerHTML = ''; this.debugLog('Debug console cleared'); });
    dom.debugToggle.addEventListener('change', async () => { this.debugEnabled = dom.debugToggle.checked; await this.saveSetting('debugEnabled', this.debugEnabled); this.updateDebugVisibility(); this.debugLog(`Debug console ${this.debugEnabled ? 'enabled' : 'disabled'}`); });
    dom.languageSelect.addEventListener('change', async () => { await this.saveSetting('summaryLanguage', dom.languageSelect.value); this.debugLog(`Summary language changed to: ${dom.languageSelect.value}`); });
    dom.summaryLevelSelect.addEventListener('change', async () => { await this.saveSetting('summaryLevel', dom.summaryLevelSelect.value); this.debugLog(`Summary level changed to: ${dom.summaryLevelSelect.value}`); });
    this._tabCleanup = setupTabLifecycleListeners(this, () => this.debouncedRefreshSelectedGroup());
    this._readingListCleanup = setupReadingListLifecycleListeners(this, () => this.debouncedRefreshReadingList());
  }

  debouncedRefreshReadingList() { if (!this._rlRefresh) this._rlRefresh = createDebounce(() => this.refreshReadingListEntries(), Timings.DEBOUNCE_REFRESH_MS); this._rlRefresh(); }

  async refreshReadingListEntries() {
    if (!chrome.readingList) return;
    const { entries, selectedIds } = await refreshReadingList(this.selectedReadingListUrls, this.debugLog.bind(this));
    this.readingListEntries = entries;
    this.selectedReadingListIds = selectedIds;
    if (this.currentSource === SourceType.READING_LIST) this._renderReadingList();
    this.updateButtonsState();
    this.saveSharedContext();
  }

  debouncedRefreshSelectedGroup() {
    if (this._refreshTimer) clearTimeout(this._refreshTimer);
    this._refreshTimer = setTimeout(() => this.refreshSelectedGroupTabs(), Timings.DEBOUNCE_REFRESH_MS);
  }

  async refreshSelectedGroupTabs() {
    if (this.selectedGroupId === null) return;
    try {
      const tabs = await chrome.tabs.query({ groupId: this.selectedGroupId });
      const oldTabIds = new Set(this.groupTabs.map(t => t.id));
      this.groupTabs = tabs;
      const newTabIds = new Set(tabs.map(t => t.id));
      for (const id of this.selectedTabIds) { if (!newTabIds.has(id)) this.selectedTabIds.delete(id); }
      this._renderPagesList();
      this.updateButtonsState();
      this.saveSharedContext();
      this.debugLog(`Refreshed group tabs: ${tabs.length} tabs (was ${oldTabIds.size})`);
    } catch (error) { this.debugLog(`Error refreshing group tabs: ${error.message}`, 'error'); }
  }

  async checkAuthStatus() { this.isAuthenticated = await checkAuthStatus(this.dom, this.debugLog.bind(this)); }

  updateAuthUI(authenticated) { updateAuthUI(this.dom, authenticated); this.updateButtonsState(); }

  updateButtonsState() {
    let hasSelection = false;
    if (this.currentSource === SourceType.CURRENT_TAB) hasSelection = true;
    else if (this.currentSource === SourceType.TAB_GROUP) hasSelection = this.selectedTabIds.size > 0;
    else if (this.currentSource === SourceType.READING_LIST) hasSelection = this.selectedReadingListIds.size > 0;
    this.dom.summarizeBtn.disabled = !this.isAuthenticated || !hasSelection;
  }

  async handleConnect() { await handleConnect(this.dom, this.debugLog.bind(this), (m) => showError(this.dom, m), () => hideError(this.dom)); }
  async handleDisconnect() { await handleDisconnect(this.dom, this.debugLog.bind(this), (m) => showError(this.dom, m), () => hideError(this.dom), () => hideSummary(this.dom)); }

  async loadTabGroups() { this.allGroups = await loadTabGroups(this.dom, this.debugLog.bind(this), (m) => showError(this.dom, m)); }

  handleGroupSelect() {
    handleGroupSelect(this.dom, this.dom.groupSelect.value, this.debugLog.bind(this), (m) => showError(this.dom, m), () => hideSummary(this.dom), () => hideError(this.dom), (groupId, tabs) => {
      this.selectedGroupId = groupId;
      this.groupTabs = tabs;
      this.selectedTabIds = new Set(tabs.map(t => t.id));
      this._renderPagesList();
      this.updateButtonsState();
      this.saveSharedContext();
    });
  }

  _renderPagesList() {
    renderPagesList(this.dom, this.groupTabs, this.selectedTabIds, {
      onTabSelect: (id, checked) => { if (checked) this.selectedTabIds.add(id); else this.selectedTabIds.delete(id); this.updateButtonsState(); this.saveSharedContext(); this.debugLog(`Tab selection changed: ${this.selectedTabIds.size} selected`); },
      onTabClose: async (id) => { try { await chrome.tabs.remove(id); this.debugLog(`Closed tab ${id}`); this.selectedTabIds.delete(id); this.groupTabs = this.groupTabs.filter(t => t.id !== id); this._renderPagesList(); this.updateButtonsState(); this.saveSharedContext(); } catch (err) { this.debugLog(`Failed to close tab ${id}: ${err.message}`, 'error'); } },
      debugLog: this.debugLog.bind(this)
    });
  }

  async loadReadingList() {
    this.readingListEntries = await loadReadingList(this.dom, this.debugLog.bind(this), (m) => showError(this.dom, m));
    if (this.readingListEntries.length > 0) this._renderReadingList();
  }

  _renderReadingList() {
    renderReadingList(this.dom, this.readingListEntries, this.selectedReadingListIds, {
      onEntrySelect: (index, url, checked) => { if (checked) { this.selectedReadingListIds.add(index); this.selectedReadingListUrls.add(url); } else { this.selectedReadingListIds.delete(index); this.selectedReadingListUrls.delete(url); } this.updateButtonsState(); this.saveSharedContext(); this.debugLog(`Reading list selection changed: ${this.selectedReadingListIds.size} selected`); },
      onEntryClose: async (url, index) => { const ok = await removeReadingListEntry(url, this.debugLog.bind(this)); if (ok) { this.selectedReadingListIds.delete(index); this.selectedReadingListUrls.delete(url); this.readingListEntries = this.readingListEntries.filter(e => e.url !== url); this._renderReadingList(); this.updateButtonsState(); this.saveSharedContext(); } },
      debugLog: this.debugLog.bind(this)
    });
  }

  handleSelectAll() {
    if (this.currentSource === SourceType.TAB_GROUP) { this.selectedTabIds = new Set(this.groupTabs.map(t => t.id)); this.dom.pagesList.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true); this.debugLog(`Selected all ${this.selectedTabIds.size} tabs`); }
    else if (this.currentSource === SourceType.READING_LIST) { this.selectedReadingListIds = new Set(this.readingListEntries.map((_, i) => i)); this.selectedReadingListUrls = new Set(this.readingListEntries.map(e => e.url)); this.dom.readinglistList.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true); this.debugLog(`Selected all ${this.selectedReadingListIds.size} reading list entries`); }
    this.updateButtonsState(); this.saveSharedContext();
  }

  handleDeselectAll() {
    if (this.currentSource === SourceType.TAB_GROUP) { this.selectedTabIds.clear(); this.dom.pagesList.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false); this.debugLog('Deselected all tabs'); }
    else if (this.currentSource === SourceType.READING_LIST) { this.selectedReadingListIds.clear(); this.selectedReadingListUrls.clear(); this.dom.readinglistList.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false); this.debugLog('Deselected all reading list entries'); }
    this.updateButtonsState(); this.saveSharedContext();
  }

  handleSourceChange() {
    this.currentSource = this.dom.sourceSelect.value;
    this.debugLog(`Source changed to: ${this.currentSource}`);
    this.selectedTabIds.clear(); this.selectedReadingListIds.clear(); this.selectedReadingListUrls.clear();
    hideSummary(this.dom); hideError(this.dom);
    if (this.currentSource === SourceType.CURRENT_TAB) { this.dom.groupSection.classList.add('hidden'); this.dom.readinglistSection.classList.add('hidden'); this.dom.pagesSection.classList.add('hidden'); }
    else if (this.currentSource === SourceType.TAB_GROUP) { this.dom.groupSection.classList.remove('hidden'); this.dom.readinglistSection.classList.add('hidden'); this.dom.pagesSection.classList.add('hidden'); }
    else if (this.currentSource === SourceType.READING_LIST) { this.dom.groupSection.classList.add('hidden'); this.dom.pagesSection.classList.add('hidden'); this.loadReadingList(); }
    this.updateButtonsState(); this.saveSharedContext();
  }

  async handleCopySummary() {
    const text = this.dom.summaryContent.textContent;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      const originalText = this.dom.copySummaryBtn.innerHTML;
      this.dom.copySummaryBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Copied!';
      setTimeout(() => { this.dom.copySummaryBtn.innerHTML = originalText; }, Timings.CLIPBOARD_RESET_MS);
      this.debugLog('Summary copied to clipboard');
    } catch (error) { this.debugLog(`Failed to copy: ${error.message}`, 'error'); }
  }

  async handleSummarize() {
    await handleSummarize({
      source: this.currentSource, dom: this.dom, groupTabs: this.groupTabs,
      selectedTabIds: this.selectedTabIds, readingListEntries: this.readingListEntries,
      selectedReadingListIds: this.selectedReadingListIds, isAuthenticated: this.isAuthenticated,
      debugLog: this.debugLog.bind(this), updateButtonsState: () => this.updateButtonsState()
    });
  }

  showLoading() { showLoading(this.dom); }
  hideLoading() { hideLoading(this.dom); }
  showSummary(text) { showSummary(this.dom, text); this._saveSessionState(); }
  hideSummary() { hideSummary(this.dom); this._saveSessionState(); }
  showError(message) { showError(this.dom, message); this.debugLog(`Error: ${message}`, 'error'); this._saveSessionState(); }
  hideError() { hideError(this.dom); this._saveSessionState(); }
  updateProgress(current, total) { updateProgress(this.dom, current, total); }
}
