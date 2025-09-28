# SideStack Chrome Extension

<div align="center">
  <img src="icons/icon128.png" alt="SideStack Logo" width="128" height="128">
</div>

SideStack is a vertical tab manager for Google Chrome that provides an organized view of your browser tabs with search, suspend/restore functionality, and support for Chrome's native tab groups.

## Features

- **Vertical Tab List**: Clean, organized view of all open tabs in a vertical layout
- **Fuzzy Search**: Quickly find tabs by title or URL with fuzzy matching
- **Tab Management**: Pin/unpin tabs, close tabs, and switch between them
- **Suspend & Restore**: Discard tabs to free memory while preserving their state for later restoration
- **Tab Groups Support**: Work with Chrome's native tab groups - move tabs between groups and expand/collapse groups
- **Context Menu**: Right-click tabs for quick actions (suspend, close, etc.)
- **Theme Support**: Light/dark mode toggle and compact view options

## Installation (Developer Mode)

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `/Users/hbarnes/Downloads/sidestack` directory

The extension icon will appear in the toolbar. Pin it for quicker access.

## Usage

- Click the SideStack action button to open the popup
- **Search**: Type in the search box to fuzzy match tabs by title or URL
- **Tab Actions**: Click tabs to switch to them, use the × button to close, or right-click for context menu
- **Suspend Tabs**: Right-click a tab and select "Suspend" to free memory while keeping it restorable
- **Tab Groups**: Chrome tab groups are automatically displayed - click the folder icon to expand/collapse
- **Settings**: Click the settings icon in the footer to access theme and display options

### Settings

- **Theme Mode**: Toggle between light and dark themes
- **Compact Mode**: Enable compact tab display for more tabs per screen
- **Panel Location**: Choose whether the extension opens on the left or right side

## Development Notes

- The background service worker lives in `background.js`
- Popup UI assets are under `popup/`
- A lightweight `nanoid` implementation sits in `vendor/`

### Code Quality

Before pushing new code, ensure it passes formatting and linting checks:

```bash
npx prettier --write "**/*.js"    # Format JavaScript files
npx eslint "**/*.js"              # Lint JavaScript files
```

### Recommended Commands

```bash
npm install              # (optional) set up tooling if you add build steps
# For linting added Python files, run `ruff check <paths>` per user preference
```

## Testing

Chrome extensions cannot run automated tests out of the box, so validate manually:

- Open multiple tabs and verify they appear in the vertical list
- Use the search box to filter tabs by title or URL
- Right-click a tab and suspend it, then restore it from the context menu
- Create Chrome tab groups and verify they're displayed with expand/collapse functionality
- Move tabs between groups using drag and drop
- Toggle between light and dark themes in settings
- Test compact mode display option

## Packaging

When ready for distribution:

1. Ensure manifest version and assets are up to date
2. From `chrome://extensions`, press **Pack extension...** and choose the project directory
3. Upload the generated CRX to the Chrome Web Store (Developer Dashboard)

