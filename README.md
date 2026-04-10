# Tab Group Summarizer - Chrome Extension

A Chrome Extension (Manifest V3) that reads the content of all tabs within a specific Tab Group, summarizes them using OpenAI Codex API (free tier), and optionally closes the tabs after confirmation.

## Features

- 🔍 **Auto-detects** the current tab's group
- 📄 **Extracts content** from all tabs in the group using smart selectors
- 🤖 **AI-powered summarization** via OpenAI Codex (free tier)
- 🔐 **OAuth PKCE authentication** (like Cline) - sign in with your OpenAI account
- 📊 **Progress tracking** with loading states
- ✅ **Safe tab closing** with confirmation dialog
- 🎨 **Clean, modern UI**

## Project Structure

```
chrome-group-summarizer/
├── manifest.json          # Extension configuration (Manifest V3)
├── popup.html             # Popup UI structure
├── popup.js               # Popup logic and event handlers
├── styles.css             # UI styling
├── background.js          # Service worker (OAuth + OpenAI Codex API calls)
├── content.js             # Content extraction script
├── icons/
│   └── icon.svg           # SVG source icon
├── .gitignore             # Git ignore rules
└── README.md              # This file
```

## Setup Instructions

### 1. Load the Extension in Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `chrome-group-summarizer` folder
5. The extension icon should appear in your toolbar

### 2. Authenticate with OpenAI

1. Click the extension icon
2. Click **Connect to ChatGPT**
3. An OpenAI sign-in page will open
4. Sign in with your OpenAI account
5. After successful authentication, you'll be redirected back automatically
6. The extension will store your access token and refresh it automatically

### 3. Using the Extension

1. **Group your tabs**: Right-click any tab → "Add tab to new group" (or existing group)
2. **Click the extension icon** while viewing a tab in the group
3. **Click "Summarize Group"** to start the summarization
4. **Review the summary** in the popup
5. **Click "Done & Close Group"** when finished (with confirmation)

## How It Works

### Authentication (OAuth PKCE - like Cline)

The extension uses the OpenAI Codex OAuth flow:
1. Generates a PKCE code verifier and challenge
2. Opens `auth.openai.com` for you to sign in
3. Intercepts the callback URL with the auth code
4. Exchanges the code for access + refresh tokens
5. Automatically refreshes tokens when they expire

### Content Extraction (`content.js`)

The extension injects a content script into each tab that:
1. Tries smart selectors (`article`, `main`, `.content`, etc.)
2. Falls back to `document.body.innerText` with cleanup
3. Removes navigation, ads, footers, and other non-content elements
4. Limits content to ~50k characters per page

### Summarization (`background.js`)

The service worker:
1. Collects content from all tabs in the group
2. Builds a structured prompt with tab titles and URLs
3. Truncates if content exceeds token limits (~100k chars)
4. Sends to OpenAI Codex API (`https://chatgpt.com/backend-api/conversation`)
5. Returns the summary to the popup

### UI (`popup.html/js/css`)

The popup provides:
1. Authentication status and connect/disconnect buttons
2. Tab group detection with color indicator
3. Tab count display
4. Progress bar during extraction
5. Loading spinner during AI processing
6. Summary display with scrollable area
7. Safe close button with confirmation

## Permissions Explained

| Permission | Purpose |
|------------|---------|
| `tabGroups` | Read tab group information |
| `tabs` | Query and manage tabs |
| `scripting` | Inject content extraction script |
| `storage` | Store OAuth tokens |
| `<all_urls>` | Access content on any page |

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "No tab group detected" | Make sure your tabs are grouped (right-click tab → Add to group) |
| "Not authenticated" | Click "Connect to ChatGPT" and sign in |
| "Authentication failed" | Your session may have expired. Disconnect and reconnect. |
| "Authentication timed out" | Complete the sign-in within 5 minutes |
| Content not extracted | Some pages (chrome://, about:) are restricted |
| Summary too long/short | Adjust the API call parameters in background.js |

## License

MIT License - Feel free to modify and distribute.
