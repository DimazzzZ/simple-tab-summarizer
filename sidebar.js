// Sidebar entrypoint — thin wrapper around shared UIController
import { UIController } from './ui-controller.js';
import { buildDomBindings } from './dom/dom-bindings.js';

document.addEventListener('DOMContentLoaded', async () => {
  const dom = buildDomBindings();
  const controller = new UIController(dom, {
    defaultModeLabel: 'Popup',
    onModeToggle: async () => {
      await chrome.runtime.sendMessage({ action: 'set_display_mode', mode: 'popup' });
    }
  });

  await controller.loadSettings();
  await controller.checkAuthStatus();
  await controller.loadTabGroups();
  controller.setupEventListeners();
});
