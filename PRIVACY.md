# Privacy Policy — Simple Tab Summarizer

**Last updated:** April 20, 2026

## Overview

Simple Tab Summarizer is a Chrome Extension that summarizes web page content using AI. This privacy policy explains what data the extension collects, how it is used, and where it is sent.

## Data Collection and Usage

### Page Content
- **What is collected:** The extension extracts text content from the currently active tab or selected tabs (titles, URLs, and page text).
- **How it is used:** The extracted content is sent to the ChatGPT API (`chatgpt.com`) to generate an AI-powered summary.
- **Where it is sent:** Content is sent directly to OpenAI/ChatGPT's servers for processing. No content is stored permanently by the extension.

### Authentication
- **What is collected:** OAuth tokens (access token, refresh token) from OpenAI/ChatGPT authentication.
- **How it is used:** Tokens are stored locally in your browser (`chrome.storage.local`) to maintain your authenticated session and automatically refresh your access token when it expires.
- **Where it is stored:** Tokens are stored only in your local browser storage. They are never transmitted to any server other than OpenAI's authentication servers.

### Settings
- **What is collected:** Your display mode preference (popup vs. sidebar), debug console setting, selected summary language, and summary verbosity level (short, medium, or detailed).
- **How it is used:** These settings are stored locally to persist your preferences across browser sessions.

## Data Sharing

- **No data is sold or shared** with third parties beyond what is necessary for the extension to function.
- Page content is sent **only** to OpenAI/ChatGPT's API for summarization.
- No analytics, tracking, or advertising services are used.
- No data is shared with the extension developer.

## User Control

- **Disconnect:** You can disconnect from ChatGPT at any time by clicking the "Disconnect" button in the extension. This does not delete stored tokens — you may need to clear browser data to fully remove them.
- **Clear data:** You can clear all stored data (including tokens and settings) by removing the extension or clearing your browser's extension storage.
- **Uninstall:** Removing the extension will delete all locally stored data.

## Permissions Justification

| Permission | Why it is needed |
|------------|-----------------|
| `tabs` | To query and read information about your open tabs |
| `tabGroups` | To identify and list your tab groups for selection |
| `scripting` | To inject a content extraction script into web pages |
| `storage` | To store OAuth tokens, settings, and preferences locally |
| `readingList` | To access your Chrome Reading List entries for summarization |
| `sidePanel` | To enable the sidebar panel display mode |
| `<all_urls>` (host permission) | To extract content from any web page you choose to summarize |

## Changes to This Policy

This privacy policy may be updated from time to time. Changes will be reflected in this document with an updated "Last updated" date.

## Contact

For questions about this privacy policy, please reach out through the extension's repository or support channels.
