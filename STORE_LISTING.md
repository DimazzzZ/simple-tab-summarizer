# Chrome Web Store Listing — Simple Tab Summarizer

## Store Description

**Short description (132 characters max):**
Free AI summarizer for tabs, tab groups, and reading lists. Get instant summaries in 40+ languages with ChatGPT.

**Full description:**
Simple Tab Summarizer uses AI to summarize web pages, tab groups, and reading lists — saving you time and screen space.

### Features

• **Current Tab Summary** — Get a quick summary of the active tab with one click
• **Tab Group Summarization** — Select and summarize all tabs in a group at once with live auto-refresh
• **Reading List Summarization** — Summarize pages saved to Chrome's Reading List with live auto-refresh
• **Configurable Verbosity** — Choose between Short, Medium, or Detailed summary levels
• **Expand Summary** — View summaries in a full-page overlay for better readability
• **40+ Languages** — Choose your summary language from Arabic to Vietnamese
• **Popup or Sidebar** — Use as a compact popup or a persistent sidebar panel with shared session state
• **Free to Use** — The extension itself is free. You connect it with your ChatGPT/OpenAI account. OpenAI offers a free ChatGPT tier for many users, but availability, supported features, and usage limits depend on OpenAI's current policies and your account status.

### How to Use

1. **Group your tabs** (right-click a tab → "Add tab to new group")
2. **Click the extension icon** to open the popup
3. **Select a tab group** or switch to Reading List mode
4. **Choose your language and summary level** and click "Summarize Selected"
5. **Review the summary** — view it in the popup or expand it to a full-page overlay

### Privacy

This extension extracts text content from web pages you choose and sends it to ChatGPT's API for summarization. No data is stored, sold, or shared beyond what is necessary for the extension to function. See our full privacy policy at: https://github.com/DimazzzZ/simple-tab-summarizer/blob/main/PRIVACY.md

### Permissions Justification

| Permission | Why it's needed |
|------------|----------------|
| `tabs` | To query and read information about your open tabs |
| `tabGroups` | To identify and list your tab groups for selection |
| `scripting` | To inject a content extraction script into web pages |
| `storage` | To store OAuth tokens, settings, and preferences locally |
| `readingList` | To access your Chrome Reading List entries for summarization |
| `sidePanel` | To enable the sidebar panel display mode |
| `<all_urls>` | To extract content from any web page you choose to summarize |

---

## Store Assets Checklist

| Asset | Size | Status |
|-------|------|--------|
| Small tile icon | 128x128 PNG | ✅ `icons/icon128.png` |
| Large tile icon | 440x280 PNG | ⬜ Needs design |
| Screenshots (min 1) | 1280x800 or 640x480 | ✅ See `screenshots/` folder |
| Promotional tile (optional) | 440x50 | ⬜ Optional |
| YouTube video (optional) | — | ⬜ Optional |

### Available Screenshots

| File | Description |
|------|-------------|
| `screenshots/01-current-tab-mode.png` | Current tab summarization UI |
| `screenshots/02-tab-group-selection.png` | Tab group selection with page picker |
| `screenshots/03-tab-group-summary.png` | Tab group summary result |
| `screenshots/04-reading-list-mode.png` | Reading list summarization |
| `screenshots/05-sidebar-mode.png` | Sidebar display mode |

---

## Category

**Primary:** Productivity  
**Secondary:** (none)

---

## Languages Supported

Arabic, Bengali, Bulgarian, Catalan, Chinese, Croatian, Czech, Danish, Dutch, English, Estonian, Finnish, French, German, Greek, Hebrew, Hindi, Hungarian, Indonesian, Italian, Japanese, Korean, Latvian, Lithuanian, Malay, Norwegian, Persian, Polish, Portuguese, Romanian, Russian, Serbian, Slovak, Slovenian, Spanish, Swedish, Thai, Turkish, Ukrainian, Urdu, Vietnamese
