/**
 * Minimal `chrome` global shim for running background.js under Node.
 *
 * background.js registers `chrome.tabs.onUpdated` / `chrome.runtime.onMessage`
 * listeners at module top-level. Importing it in Node would throw
 * "chrome is not defined" without this shim. ESM evaluates imports in order,
 * so test files import THIS module before importing background.js.
 */

globalThis.chrome = {
  tabs: {
    onUpdated: { addListener: () => {} },
    remove: async () => {},
    create: async () => ({ id: 1, url: 'http://test' })
  },
  runtime: {
    onMessage: { addListener: () => {} }
  },
  storage: {
    local: {
      get: async () => ({}),
      set: async () => {},
      remove: async () => {}
    }
  },
  action: {
    setPopup: () => {}
  },
  sidePanel: {
    setOptions: async () => {},
    setPanelBehavior: () => {}
  },
  windows: {
    getAll: async () => []
  }
};
