// Popup entrypoint — thin wrapper around shared UIController
import { UIController } from './ui-controller.js';
import { buildDomBindings } from './dom/dom-bindings.js';

document.addEventListener('DOMContentLoaded', async () => {
  const dom = buildDomBindings();
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
