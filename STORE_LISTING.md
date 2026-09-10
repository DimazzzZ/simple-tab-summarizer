# Chrome Web Store Listing — Simple Tab Summarizer

## Store Description

Private, on-device AI summaries for tabs, tab groups, and reading lists. No sign-up. No API key. Nothing leaves your device.

Simple Tab Summarizer runs on Chrome's built-in AI (Gemini Nano) — the same on-device model Chrome ships with — so summaries are generated locally on your machine. Just install it and click Summarize. Optional ChatGPT sign-in only if you need a language the on-device model doesn't cover yet.

How the AI works:
- On-device by default — Chrome's built-in AI (Gemini Nano) summarizes everything locally. Free, private, no account.
- Requires Chrome 138+ with supported hardware. First use downloads the model (~2 GB, one-time), shown as a progress bar.
- Built-in AI languages: English, Japanese, Spanish, German, French.
- Optional ChatGPT fallback — only used when you pick a summary language the built-in model doesn't yet support (the other ~35 languages in the dropdown). If you never pick one of those languages, you never need to sign in.

Features:
- Current Tab Summary — one-click summary of the active tab
- Tab Group Summarization — select and summarize a whole tab group at once, with live auto-refresh
- Reading List Summarization — summarize pages saved to Chrome's Reading List, with live auto-refresh
- Configurable Verbosity — Short, Medium, or Detailed
- Expand Summary — view the result in a full-page overlay on the active tab
- 40+ Languages — 5 handled on-device by built-in AI, the rest via optional ChatGPT fallback
- Popup or Sidebar — compact popup or persistent side panel, with shared session state
- Free — the extension itself is free. The default (built-in AI) is free forever with no account. If you opt into the ChatGPT fallback for extra languages, availability and limits depend on your OpenAI account and their current policies.

What's new in 1.3.0:
- On-Device AI by Default: Summaries now run on Chrome's built-in AI (Gemini Nano) — on-device, private, no sign-up, no API key. Requires Chrome 138+ with supported hardware.
- Built-in AI Languages: English, Japanese, Spanish, German, and French are handled entirely on-device. Nothing leaves your machine.
- ChatGPT Only for Extra Languages: The other ~35 languages in the dropdown use ChatGPT — only if you sign in. If you stick to the built-in languages, no account is needed at all.
- Choose Your AI: A new AI Provider option lets you pick Automatic (built-in AI first), Built-in AI only, or ChatGPT only. Your choice is remembered.
- On-Device Model Download: On first use, a progress bar shows the built-in model downloading (~2 GB, one-time). No data leaves your device.

What's new in 1.2.4:
- Summarization Fix: Restored summaries after OpenAI retired the previous model — now uses gpt-5.6-luna
- Model Fallback: Automatically retries with an alternate model if one becomes unavailable, so summaries keep working through future model changes
- More Reliable Streaming: Hardened response parsing so summaries render consistently

What's new in 1.2.3:
- Installation Fix: Restored the runtime script omitted from the Chrome Web Store package
- Closed Shadow DOM Extraction: Run the capture and extraction scripts in the same page execution world
- Release Validation: Verify every manifest resource exists in the final extension package

What's new in 1.2.2:
- API Error Handling: Improved error handling with better retry logic and clearer authentication failure messages
- Test Infrastructure: Replaced external Google Doc tests with mocked fixtures for reliable CI

What's new in 1.2.1:
- Closed Shadow DOM Extraction: Fixed content extraction for platforms using closed shadow DOMs (e.g., Skilljar on Vue 3)
- Google Docs Extraction: Document text from Google Docs is now properly extracted via DOCS_modelChunk JSON parsing
- Session State Persistence: Summaries are now reliably saved to storage after each run, with a 30-minute TTL to prevent stale state restore

What's new in 1.2.0:
- Stop Summarization: Cancel ongoing summarization requests mid-flight with a new Stop button
- Dynamic Page Content Extraction: Improved support for JavaScript-heavy pages (Atlassian, Google Dev Blog, etc.) that now wait for content to load before extracting
- Unicode-Safe Text Processing: Fixed extraction to properly handle Cyrillic, CJK, and all non-Latin text
- Enhanced Summary Overlay Typography: Prevents host page styles from overriding the modal's font stack

What's new in 1.1.1:
- Fixed packaging bug: all runtime module directories now included in release ZIP
- Added release validation checks to ensure complete builds
- Restored Connect button functionality and tabGroups permission usage

What's new in 1.1.0:
- Live auto-refresh for Tab Group and Reading List selections
- Shared popup/sidebar context and persisted summary/error session state
- Quick item actions: close tabs or remove Reading List entries directly in lists
- New summary levels: Short, Medium, Detailed
- Expand Summary overlay on the active tab with improved restricted-page error messaging

How to use:
1. Group your tabs (right-click a tab -> "Add tab to new group")
2. Click the extension icon to open the popup
3. Select a tab group or switch to Reading List mode
4. Choose your language and summary level, then click "Summarize Selected"
5. Review the summary in the popup, or expand it to a full-page overlay

Privacy:
By default, summarization runs entirely on-device with Chrome's built-in AI — the text of the pages you choose never leaves your machine. Only if you opt into the ChatGPT fallback (for languages the built-in model doesn't support) is that text sent to ChatGPT's API for summarization. No data is stored, sold, or shared beyond what is necessary for the extension to function. See our full privacy policy at: https://github.com/DimazzzZ/simple-tab-summarizer/blob/main/PRIVACY.md

Official website:
https://github.com/DimazzzZ/simple-tab-summarizer

Share your improvement ideas and questions here:
https://github.com/DimazzzZ/simple-tab-summarizer/issues

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
