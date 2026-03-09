# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2026-03-09

### Added
- **Hybrid Architecture:** Control plane in Docker, data plane (agents) on Host/WSL via tmux socket sharing.
- **Commander View (Global Dashboard):** A bird's-eye view of all active sessions with real-time status and quick controls.
- **Auto-Yes Intelligence:** Automatically detects `(y/n)` prompts and responds with 'y' based on session settings.
- **Enter Shell:** One-click to open a new bash session in the same directory as an existing agent.
- **ANSI Color Support:** Full-color terminal rendering in the browser using `ansi-to-html`.
- **i18n Help System:** Comprehensive guide and UI available in both Japanese and English.
- **Mobile-First Responsive UI:** Optimized single-column layout for controlling agents on the go.
- **Secure Remote Access:** Integrated Cloudflare Tunnel support for `unlaxer.org`.
- **Bidirectional Navigation:** Deep links between the global dashboard and individual session cards.
- **Custom Agent Launcher:** UI to start new tmux sessions with custom commands and working directories.

### Fixed
- Improved command reliability by switching to `spawnSync` for tmux interactions.
- Resolved input lag by implementing individual session refreshing.
- Fixed layout breaking issues in terminal preview.
