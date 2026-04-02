# Claude Incognito Saver

A Chrome extension that saves conversations, prompts, responses, and file metadata from Claude's incognito mode.

## Features

- **Save conversations** in Markdown, JSON, or HTML format
- **Store locally** in the extension's storage for later export
- **Capture file metadata** — names, types, and thumbnails of attached files
- **Extract code blocks** with language labels
- **Capture thinking steps** (the collapsed reasoning summaries)
- **Capture artifacts** — names and types of generated files
- **Floating save button** appears automatically on claude.ai
- **Works in both incognito and regular Claude chats**

## Installation

### Method 1: Load as Unpacked Extension (Developer Mode)

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `claude-incognito-saver` folder
5. The extension icon should appear in your toolbar

### Method 2: From ZIP

1. Extract the ZIP file to a folder on your computer
2. Follow steps 1-5 above

## Usage

### Floating Button (on claude.ai)
When you're on claude.ai, a floating save button (orange circle) appears in the bottom-right corner. Click it to see export options:

- **Save as Markdown** — Downloads a `.md` file with the full conversation
- **Save as JSON** — Downloads structured JSON with all metadata
- **Save as HTML** — Downloads a styled, self-contained HTML page
- **Copy to Clipboard** — Copies the Markdown version
- **Save to Extension** — Stores the conversation in Chrome's local storage

### Extension Popup
Click the extension icon in your toolbar to:

- Export the current conversation in any format
- View previously saved conversations
- Re-export saved conversations
- Delete saved conversations
- See storage usage

## What Gets Captured

| Data | Captured |
|------|----------|
| User prompts | ✅ Full text |
| Claude responses | ✅ Full text with formatting |
| Code blocks | ✅ With language labels |
| Thinking steps | ✅ Summary text |
| Attached files | ✅ Name, type, thumbnail URL |
| Artifacts | ✅ Name and type |
| Timestamps | ✅ When available |
| Incognito status | ✅ Detected automatically |

## Limitations

- **File contents** are not captured (only metadata like name/type). Claude doesn't expose raw file contents in the DOM.
- **Image thumbnails** are captured as URLs that may expire after the session ends.
- **Very long conversations** may approach Chrome's storage limits (~10 MB for `chrome.storage.local`).
- The extension scrapes the DOM, so if Claude significantly changes their UI structure, selectors may need updating.

## Privacy

- All data stays local on your machine
- Nothing is sent to any external server
- Data is stored in Chrome's extension storage (`chrome.storage.local`)
- You can delete all saved data at any time from the popup

## File Structure

```
claude-incognito-saver/
├── manifest.json          # Extension manifest (MV3)
├── popup.html             # Extension popup UI
├── css/
│   ├── content.css        # Styles for the floating button
│   └── popup.css          # Styles for the popup
├── js/
│   ├── content.js         # DOM scraper + floating button
│   ├── popup.js           # Popup logic
│   └── background.js      # Storage management
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```
