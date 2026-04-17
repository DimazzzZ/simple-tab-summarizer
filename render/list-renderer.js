/**
 * List rendering module.
 * Renders tab group and reading list rows with checkboxes and close buttons.
 */

/**
 * Renders the tab group pages list.
 * @param {Object} dom - DOM references
 * @param {Object[]} groupTabs - Array of tab objects
 * @param {Set<number>} selectedTabIds - Set of selected tab IDs
 * @param {Object} handlers - Event handlers
 * @param {Function} handlers.onTabSelect - Called when a tab checkbox changes
 * @param {Function} handlers.onTabClose - Called when a tab close button is clicked
 * @param {Function} handlers.debugLog - Logger function
 */
export function renderPagesList(dom, groupTabs, selectedTabIds, handlers) {
  dom.pagesList.innerHTML = '';
  const fragment = document.createDocumentFragment();

  for (const tab of groupTabs) {
    const item = document.createElement('div');
    item.className = 'page-item fade-in';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = tab.id;
    checkbox.checked = selectedTabIds.has(tab.id);
    checkbox.addEventListener('change', (e) => handlers.onTabSelect(tab.id, e.target.checked));

    const text = document.createElement('span');
    text.className = 'page-title';
    text.textContent = tab.title || 'Untitled';
    text.title = tab.url;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'page-close-btn';
    closeBtn.innerHTML = '&times;';
    closeBtn.title = 'Close tab';
    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handlers.onTabClose(tab.id);
    });

    item.appendChild(checkbox);
    item.appendChild(text);
    item.appendChild(closeBtn);
    fragment.appendChild(item);
  }

  dom.pagesList.appendChild(fragment);
  handlers.debugLog(`Rendered ${groupTabs.length} page checkboxes`);
}

/**
 * Renders the reading list entries.
 * @param {Object} dom - DOM references
 * @param {Object[]} entries - Array of reading list entries
 * @param {Set<number>} selectedIds - Set of selected entry indices
 * @param {Object} handlers - Event handlers
 * @param {Function} handlers.onEntrySelect - Called when an entry checkbox changes
 * @param {Function} handlers.onEntryClose - Called when an entry close button is clicked
 * @param {Function} handlers.debugLog - Logger function
 */
export function renderReadingList(dom, entries, selectedIds, handlers) {
  dom.readinglistList.innerHTML = '';
  const fragment = document.createDocumentFragment();

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const item = document.createElement('div');
    item.className = 'page-item fade-in';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = i;
    checkbox.checked = selectedIds.has(i);
    checkbox.addEventListener('change', (e) => handlers.onEntrySelect(i, entry.url, e.target.checked));

    const text = document.createElement('span');
    text.className = 'page-title';
    text.textContent = entry.title || entry.url;
    text.title = entry.url;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'page-close-btn';
    closeBtn.innerHTML = '&times;';
    closeBtn.title = 'Remove from reading list';
    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handlers.onEntryClose(entry.url, i);
    });

    item.appendChild(checkbox);
    item.appendChild(text);
    item.appendChild(closeBtn);
    fragment.appendChild(item);
  }

  dom.readinglistList.appendChild(fragment);
  handlers.debugLog(`Rendered ${entries.length} reading list checkboxes`);
}
