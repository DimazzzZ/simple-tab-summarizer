/**
 * Tab groups feature module.
 * Handles loading, selecting, and rendering tab groups.
 */

const COLOR_MAP = {
  grey: '#808080', blue: '#0066cc', red: '#dc3545',
  yellow: '#ffc107', green: '#28a745', pink: '#e83e8c',
  purple: '#6f42c1', cyan: '#17a2b8', orange: '#fd7e14'
};

/**
 * Loads all tab groups and populates the group select dropdown.
 * @param {Object} dom - DOM references
 * @param {Function} debugLog - Logger function
 * @param {Function} showError - Error display function
 * @returns {Promise<Object[]>} Array of tab group objects
 */
export async function loadTabGroups(dom, debugLog, showError) {
  try {
    debugLog('Loading tab groups...');
    const allGroups = await chrome.tabGroups.query({});
    debugLog(`Found ${allGroups.length} tab groups`);

    if (allGroups.length === 0) {
      dom.groupSelect.classList.add('hidden');
      dom.noGroups.classList.remove('hidden');
      dom.pagesSection.classList.add('hidden');
      return [];
    }

    dom.groupSelect.classList.remove('hidden');
    dom.noGroups.classList.add('hidden');
    dom.groupSelect.innerHTML = '<option value="">-- Select a group --</option>';

    for (const group of allGroups) {
      const tabs = await chrome.tabs.query({ groupId: group.id });
      const option = document.createElement('option');
      option.value = group.id;
      option.textContent = `${group.title || 'Untitled'} (${tabs.length} tab${tabs.length !== 1 ? 's' : ''})`;

      const groupColor = COLOR_MAP[group.color] || '#808080';
      option.style.borderLeft = `3px solid ${groupColor}`;
      option.style.paddingLeft = '8px';

      dom.groupSelect.appendChild(option);
      debugLog(`Group: "${group.title || 'Untitled'}" - ${tabs.length} tabs`);
    }

    return allGroups;
  } catch (error) {
    debugLog(`Error loading tab groups: ${error.message}`, 'error');
    showError('Failed to load tab groups.');
    return [];
  }
}

/**
 * Loads tabs for a selected group.
 * @param {number} groupId - The selected group ID
 * @param {Function} debugLog - Logger function
 * @returns {Promise<Object[]>} Array of tab objects in the group
 */
export async function loadGroupTabs(groupId, debugLog) {
  try {
    const tabs = await chrome.tabs.query({ groupId });
    debugLog(`Loaded ${tabs.length} tabs in group`);
    return tabs;
  } catch (e) {
    debugLog(`Error loading group tabs for ${groupId}: ${e.message}`, 'error');
    return [];
  }
}

/**
 * Handles group selection change.
 * @param {Object} dom - DOM references
 * @param {string} selectedValue - The selected group value
 * @param {Function} debugLog - Logger function
 * @param {Function} showError - Error display function
 * @param {Function} hideSummary - Summary hide function
 * @param {Function} hideError - Error hide function
 * @param {Function} onGroupLoaded - Callback when group tabs are loaded
 */
export async function handleGroupSelect(dom, selectedValue, debugLog, showError, hideSummary, hideError, onGroupLoaded) {
  if (!selectedValue) {
    dom.pagesSection.classList.add('hidden');
    onGroupLoaded(null, []);
    return;
  }

  const groupId = parseInt(selectedValue);
  debugLog(`Selected group ID: ${groupId}`);

  try {
    const tabs = await loadGroupTabs(groupId, debugLog);
    onGroupLoaded(groupId, tabs);
    dom.pagesSection.classList.remove('hidden');
    hideSummary();
    hideError();
  } catch (error) {
    debugLog(`Error loading group tabs: ${error.message}`, 'error');
    showError('Failed to load tabs for this group.');
  }
}
