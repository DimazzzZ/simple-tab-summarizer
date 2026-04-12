<p align="center">
  <img src="icons/icon.svg" alt="Simple Tab Summarizer logo" width="96" />
</p>

<h1 align="center">Simple Tab Summarizer</h1>
<p align="center">Free AI summaries for the current tab, tab groups, and reading list.</p>

A Chrome Extension (Manifest V3) that reads the content of the current tab, selected tabs from a tab group, or pages from Chrome's Reading List, summarizes them using the ChatGPT Codex API, and presents the result in a popup or persistent sidebar panel.

## Free to Use

**This extension itself is free to use.** You need a ChatGPT/OpenAI account to connect it. OpenAI offers a free ChatGPT tier for many users, so you may be able to start without a paid subscription. Availability, supported features, and usage limits depend on OpenAI's current policies and your account status, and may change over time. Check [OpenAI's official pricing and usage documentation](https://openai.com/pricing) for the latest details.

## Features

- 📄 **Current Tab Summarization** — Summarize the active tab with one click (default mode)
- 📑 **Tab Group Summarization** — Extract and summarize all tabs in a selected tab group
- 📖 **Reading List Summarization** — Summarize pages saved to Chrome's Reading List (read-only)
- 🤖 **AI-powered summarization** via ChatGPT Codex API with streaming responses
- 🔐 **OAuth 2.0 PKCE authentication** — Sign in with your OpenAI/ChatGPT account, with automatic token refresh
- 🌐 **Summary Language Selector** — Choose output language from 40+ languages (A-Z sorted)
- 📌 **Popup / Sidebar Display Mode** — Toggle between a compact popup and a persistent sidebar panel
- 🐛 **Debug Console** — Optional debug logging (toggle OFF by default)
- 🎨 **Clean, modern UI** with progress tracking and error handling

## Project Structure

```
simple-tab-summarizer/
├── manifest.json            # Extension configuration (Manifest V3)
├── popup.html               # Popup UI structure
├── popup.js                 # Popup entrypoint (thin wrapper)
├── sidebar.html             # Sidebar panel UI structure
├── sidebar.js               # Sidebar entrypoint (thin wrapper)
├── ui-controller.js         # Shared UI controller (common logic for popup + sidebar)
├── styles.css               # Shared UI styling
├── background.js            # Service worker (OAuth, summarization, display mode control)
├── content.js               # Fast content extraction script (textContent-based)
├── package.json             # Node.js dependencies and npm scripts
├── package-lock.json        # Locked dependency versions
├── playwright.config.js     # Playwright E2E test configuration
├── icons/
│   ├── icon.svg             # SVG source icon
│   ├── icon16.png           # Toolbar icon (16x16)
│   ├── icon48.png           # Extension page icon (48x48)
│   └── icon128.png          # Chrome Web Store icon (128x128)
├── scripts/
│   └── generate-icons.sh    # Icon generation script
├── tests/
│   ├── e2e/                 # Playwright E2E tests
│   │   └── popup.spec.js
│   └── unit/                # Unit tests
│       ├── test-background.js
│       └── test-extraction.js
├── PRIVACY.md               # Privacy policy
├── STORE_LISTING.md         # Chrome Web Store listing
├── .gitignore               # Git ignore rules
└── README.md                # This file
```

## Setup Instructions

### 1. Load the Extension in Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `simple-tab-summarizer` folder
5. The extension icon should appear in your toolbar

### 2. Authenticate with ChatGPT

1. Click the extension icon to open the popup
2. Click **Connect to ChatGPT**
3. An OpenAI sign-in page will open in a new tab
4. Sign in with your OpenAI/ChatGPT account
5. After successful authentication, the callback is intercepted and tokens are stored automatically
6. Tokens are refreshed automatically when they expire

### 3. Using the Extension

#### Current Tab Mode (default)

1. **Open the tab** you want to summarize
2. **Click the extension icon** to open the popup
3. **Choose a summary language** from the language selector
4. **Click "Summarize Selected"** to start the summarization
5. **Review the summary** in the popup

#### Tab Group Mode

1. **Group your tabs**: Right-click any tab → "Add tab to new group" (or add to an existing group)
2. **Switch the source** to "Tab Group" using the "Summarize From" dropdown
3. **Select a tab group** from the dropdown
4. **Select pages** you want to include (or use Select All / Deselect All)
5. **Choose a summary language** from the language selector
6. **Click "Summarize Selected"** to start the summarization
7. **Review the summary** in the popup

#### Reading List Mode

1. **Switch the source** to "Reading List" using the "Summarize From" dropdown
2. **Select pages** from your Chrome Reading List
3. **Choose a summary language**
4. **Click "Summarize Selected"** to start the summarization
5. **Review the summary**

#### Popup / Sidebar Mode Toggle

- By default, the extension opens as a **popup** when you click the toolbar icon.
- Click the **📌 Sidebar** button in the top-right corner to switch to **sidebar mode**.
  - In sidebar mode, clicking the toolbar icon opens/closes the side panel.
- Click the **📌 Popup** button in the sidebar to switch back to **popup mode**.
- Your display mode preference is persisted across browser sessions.

## How It Works

### Authentication (OAuth 2.0 PKCE)

The extension uses the OpenAI OAuth PKCE flow:
1. Generates a PKCE code verifier and challenge
2. Opens `auth.openai.com` for you to sign in
3. Intercepts the `localhost:1455/auth/callback` URL with the auth code via a global tab listener
4. Exchanges the code for access + refresh tokens
5. Stores tokens in `chrome.storage.local` and automatically refreshes them before expiration

### Content Extraction (`content.js`)

The extension injects a content script into each tab that:
1. Tries domain-specific extraction (e.g., GitHub repos)
2. Falls back to fast `textContent`-based extraction from `article`, `main`, `.markdown-body` selectors
3. Falls back further to metadata (title, meta description, headings, first paragraphs)
4. Truncates to 4,000 characters per tab for efficiency

### Summarization (`background.js`)

The service worker:
1. Collects content from all selected tabs or reading list entries
2. Builds a structured prompt with page titles and URLs
3. Truncates if content exceeds token limits
4. Sends to the ChatGPT Codex API (`https://chatgpt.com/backend-api/codex/responses`) with `stream: true`
5. Parses the SSE stream (`response.output_text.delta` events) to build the summary
6. Returns the summary to the popup or sidebar panel

### Display Mode Management (`background.js`)

The service worker centrally manages the display mode:
- `set_display_mode` message: Switches between popup and sidebar mode
- `get_display_mode` message: Returns the current mode preference
- In **popup mode**: `chrome.action.setPopup({ popup: 'popup.html' })` and side panel is disabled
- In **sidebar mode**: `chrome.action.setPopup({ popup: '' })` and `openPanelOnActionClick: true`

### UI Architecture

The popup and sidebar share a common `UIController` class (`ui-controller.js`):
- `popup.js` and `sidebar.js` are thin entrypoints that create a controller instance with DOM references and mode-toggle behavior
- All shared logic (auth, extraction, summarization, settings) lives in the controller
- This eliminates duplication and ensures consistent behavior across both UIs

## Permissions Explained

| Permission | Purpose |
|------------|---------|
| `tabGroups` | Read tab group information |
| `tabs` | Query and manage tabs |
| `scripting` | Inject content extraction script into tabs |
| `storage` | Store OAuth tokens, display mode, debug settings, and language preference |
| `readingList` | Access Chrome Reading List entries (read-only) |
| `sidePanel` | Enable sidebar panel display mode |
| `<all_urls>` | Access content on any page for summarization |

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "No tab groups found" | Make sure your tabs are grouped (right-click tab → Add to group) |
| "Not connected" | Click "Connect to ChatGPT" and sign in |
| "Authentication failed" | Your session may have expired. Disconnect and reconnect. |
| "Authentication timed out" | Complete the sign-in within 5 minutes |
| Content not extracted | Some pages (`chrome://`, `about:`, `file://`) are restricted |
| "Access denied: Chrome blocked this page" | Enable "On all sites" in extension Site Access settings |
| Reading List empty | Add pages to your Reading List first (right-click page → "Add to Reading List") |
| Sidebar not showing | Click the 📌 Sidebar button in the popup to switch to sidebar mode |
| Summary seems incorrect | Try a different language or check the debug console for API errors |

## Privacy

See [PRIVACY.md](PRIVACY.md) for details on data collection, usage, and handling.

## License

[Apache 2.0](LICENSE)
