# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.1] - 2026-06-19

### Fixed
- **Closed Shadow DOM Extraction (Skilljar)**: Pages using closed shadow DOMs (e.g., Skilljar on Vue 3 with vue-shadow-dom) now have their content properly extracted via an `attachShadow` monkeypatch that captures shadow root references before they are closed.
- **Google Docs Extraction**: Document text rendered on `<canvas>` by Google Docs is now extracted by parsing the `DOCS_modelChunk` JSON embedded in the page, recovering the full document body instead of only ~368 chars of UI chrome.
- **Session State Persistence**: The session summary state is now correctly saved to `chrome.storage.local` after each summarization, and a 30-minute TTL prevents stale summaries from being restored after extended idle time.

---

## [1.2.0] - 2026-05-04

### Added
- **Stop Summarization**: Added a Stop button to cancel ongoing summarization requests mid-flight.
- **Dynamic Page Content Extraction**: Added async content extraction that waits up to 3 seconds for JavaScript-heavy pages (e.g., Atlassian, Google Dev Blog) to hydrate their article body before extracting text.
- **Unicode-Safe Text Processing**: Fixed content extraction to properly handle Cyrillic, CJK, and other non-Latin text that was previously being stripped by a Latin-only filter.

### Changed
- **Summary Overlay Typography**: Enhanced font isolation in the injected summary overlay to prevent host page styles (e.g., Meduza.io) from overriding the modal's font stack.
- **Extraction Reliability**: Both tab extraction and reading list extraction now try async extraction first, falling back to sync if it fails.

### Fixed
- **Font Inheritance in Modal**: The summary overlay now uses an explicit system font stack with `!important` scoping to prevent any host page CSS from leaking through.
- **Cyrillic/Unicode Content Loss**: Replaced `/[a-zA-Z0-9]{3,}/` filter with Unicode-aware `/\p{L}|\p{N}/u` regex so non-Latin content is preserved during extraction.

### Tests
- Added E2E tests for the Stop button in both popup and sidebar.
- Added unit tests for cancellation/abort behavior in summarization.
- Added unit tests for Cyrillic, Chinese, and mixed Unicode text preservation.

---

## [1.1.1] - 2026-04-23

### Fixed
- **Packaging Bug**: Fixed CI packaging script that omitted critical runtime module directories (`dom/`, `features/`, `constants/`, `sync/`, `render/`, `lifecycle/`, `utils/`), which caused "file not found" errors and non-functional Connect button.
- **Release Validation**: Added pre-packaging and post-packaging validation steps to GitHub Actions workflow to ensure all required files are included in the release ZIP.

### Changed
- **scripts/package-extension.sh**: Updated to copy all runtime module directories into the build output.
- **.github/workflows/release.yml**: Added validation checks for required files before packaging and verification of ZIP contents after packaging.

---

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
