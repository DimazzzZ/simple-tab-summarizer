# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-04-20

### Added
- **Configurable Summary Verbosity**: Added Short, Medium, and Detailed summary levels to control output length and depth.
- **Expand Summary Overlay**: New ability to view generated summaries in a centered full-page overlay on the active tab for improved readability.
- **Item Management Actions**: Added the ability to close tabs or remove reading list entries directly from the selection lists.
- **Shared UI Session**: Popup and sidebar now share a synchronized context (source and selection state) and persist summary/error state across close/reopen.

### Changed
- **Live Auto-Refresh**: Tab Group and Reading List selection lists now automatically refresh when browser state changes (tabs closed/moved or entries added/removed).
- **UI Architecture**: Refactored the monolithic `ui-controller.js` into a modular structure (`features/`, `render/`, `sync/`, etc.) for better maintainability.
- **Settings Layout**: Updated settings UI to a two-column layout for Summary Level and Summary Language.
- **Error Handling**: Improved error messages when the Expand overlay cannot be injected on Chrome-restricted pages.

### Fixed
- **Source Switching**: Fixed an issue where the "Select Pages" container remained visible when switching to Reading List mode.
- **State Drift**: Eliminated synchronization drift between popup and sidebar surfaces.

### Refactored
- Modularized the UI controller into focused modules:
  - `features/` (auth, extraction, reading-list, summarize, tab-groups)
  - `render/` (list-renderer, summary-overlay, ui-feedback)
  - `sync/` (storage-sync)
  - `lifecycle/` (listeners)
  - `dom/` (dom-bindings)
  - `utils/` (logger, debounce, chrome-helpers)

### Tests
- Expanded E2E test coverage in `tests/e2e/popup.spec.js` to verify the Expand Summary overlay.

---

## [1.0.0] - 2026-04-12
- Initial release: AI-powered summarization for current tabs, tab groups, and reading lists.
