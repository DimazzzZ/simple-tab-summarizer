# Privacy Policy — Simple Tab Summarizer

**Last updated:** September 10, 2026

## Overview

Simple Tab Summarizer is a Chrome Extension that summarizes web page content using AI. This privacy policy explains what data the extension processes, how it is used, and where it is (or is not) sent.

**Short version:** By default, summarization runs entirely on your device using Chrome's built-in AI (Gemini Nano). In that mode, the page text you summarize never leaves your machine. If you choose to sign in to ChatGPT to summarize in languages the built-in model does not yet support, that text is sent to OpenAI's servers only for those summaries.

## Data Collection and Usage

### Page Content
- **What is processed:** The extension extracts text content from tabs, tab groups, or reading list entries that you explicitly choose to summarize (titles, URLs, and page text).
- **Where it is processed:**
  - **Built-in AI (default, on-device):** For English, Japanese, Spanish, German, and French, summarization runs locally in Chrome's built-in AI (Gemini Nano). The extracted content **never leaves your device** — no network request carries it off your machine.
  - **ChatGPT fallback (opt-in):** If you sign in to ChatGPT and choose a summary language the built-in model does not yet support (roughly 35 additional languages), the extracted content is sent to OpenAI's servers (`chatgpt.com`) to generate that summary. This only happens when you have signed in and made that language choice.
- **Retention:** The extension does not store page content persistently. Summaries are held in memory for display and cleared when you close the popup/sidebar or navigate away.

### Authentication
- **When it applies:** Only if you choose to enable the ChatGPT fallback by signing in. If you only ever use the built-in on-device provider, the extension collects no authentication data.
- **What is collected:** OAuth tokens (access token, refresh token) issued by OpenAI when you sign in.
- **How it is used:** Tokens are stored locally in your browser (`chrome.storage.local`) to maintain your authenticated session and automatically refresh your access token when it expires.
- **Where it is stored / sent:** Tokens are stored only in your local browser storage. They are transmitted only to OpenAI's own authentication and API servers, never to any third party.

### Settings
- **What is collected:** Your display mode preference (popup vs. sidebar), debug console setting, selected summary language, and summary verbosity level (short, medium, or detailed).
- **How it is used:** These settings are stored locally to persist your preferences across browser sessions.

## Data Sharing

- **No data is sold or shared** with third parties.
- Page content is never sent anywhere when the built-in on-device provider is used.
- Page content is sent **only** to OpenAI/ChatGPT's API, and **only** when you have signed in and selected a language the built-in model does not support.
- No analytics, tracking, or advertising services are used.
- No data is shared with the extension developer.

## User Control

- **Stay on-device:** In the extension's AI Provider setting, choose **Built-in AI only** to ensure summaries are never sent to any external service, regardless of the selected language. If a language is unsupported by the on-device model in that mode, the extension will simply refuse to summarize rather than fall back to ChatGPT.
- **Disconnect from ChatGPT:** If you previously signed in, you can disconnect from ChatGPT at any time from the extension. This clears stored OAuth tokens.
- **Clear data:** You can clear all stored data (including tokens and settings) by removing the extension or clearing your browser's extension storage.
- **Uninstall:** Removing the extension will delete all locally stored data.

## Permissions Justification

| Permission | Why it is needed |
|------------|-----------------|
| `tabs` | To query and read information about your open tabs |
| `tabGroups` | To identify and list your tab groups for selection |
| `scripting` | To inject a content extraction script into web pages |
| `storage` | To store settings, preferences, and (only if you sign in to ChatGPT) OAuth tokens locally |
| `readingList` | To access your Chrome Reading List entries for summarization |
| `sidePanel` | To enable the sidebar panel display mode |
| `<all_urls>` (host permission) | To extract content from any web page you choose to summarize |

## Changes to This Policy

This privacy policy may be updated from time to time. Changes will be reflected in this document with an updated "Last updated" date.

## Contact

For questions about this privacy policy, please reach out through the extension's repository or support channels.
