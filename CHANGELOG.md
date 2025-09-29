# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.4] - 2025-09-29

### Added
- Settings button now toggles - clicking it again closes settings and returns to home view

## [0.1.3] - 2025-09-28

### Fixed
- Restored missing context menu options (Copy Title, Copy URL, Activate, Group by Domain) in tab right-click menus

### Removed
- Spaces functionality completely removed to simplify the codebase

## [0.1.2] - 2025-09-28

### Added
- Expanded context menu options for tab groups - all individual tab actions now available for groups
- Better context menu UX with smart positioning, click-outside detection, and keyboard support (Escape key)
- Improved error handling and null safety in context menu operations

### Fixed
- Context menu positioning now stays within viewport bounds
- Better click-outside detection prevents menus from getting stuck open
- Removed code duplication by refactoring tab/group operations into reusable system

### Changed
- Code formatting and linting improvements with Prettier and ESLint
- Updated build configuration for better ES module support

## [0.1.1] - 2025-09-28

### Fixed
- Removed annoying blinking animation when switching between tabs in groups
- Group tabs now appear instantly when switching tabs, only animate when groups are expanded

## [0.1.0] - 2025-09-28

### Added
- Initial release of SideStack Chrome extension
- Vertical tab manager with organized tab listing
- Fuzzy search functionality for tabs by title and URL
- Tab management features (pin/unpin, close, switch)
- Suspend and restore tabs to manage memory usage
- Support for Chrome's native tab groups with expand/collapse functionality
- Context menu with right-click actions on tabs
- Settings panel with theme toggle (light/dark mode) and compact view option
- Panel location preference (left/right side)
- Clean, responsive UI with Material Design icons
