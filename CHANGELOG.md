# Changelog

All notable changes to this project will be documented in this file.

## [0.1.21] - 2026-03-15

### Added
- **Commander Agent Integration:** Attach autonomous "commander" sessions to target sessions for automatic prompt response
  - Auto-detect and respond to (y/n) and numbered selection prompts
  - 5-second polling interval with configurable response patterns
  - REST API for enable/disable auto-accept functionality
  - Session badges showing commander/target relationships
  - Modal UI for creating commander sessions with template selection
- **Session Store:** Manage commander↔target session relationships with metadata tracking
- **Auto-Accept Manager:** Polls target sessions and auto-responds to prompts without user intervention
- **Session Metadata Extension:** API now includes `sessionRole` and `linkedSessionId` fields for session linking
- **Documentation:** Complete user guide and API reference for Commander Agent feature
- **Session Sort Controls:** Dropdown selector in Commander view to sort sessions by Created, Activity, or Name.
- **Stable Session Ordering:** Default sort by "Created" time prevents sessions from jumping around during user interaction.
- **Multi-Host Session Discovery:** Unified API returns sessions from both HVU (SSH) and WSL (HTTP agent) in single response.
- **HTTP Agent Bridge:** Python-based HTTP proxy tunnel enables Docker containers to reach WSL tmux agent via HVU port forwarding.
- **Enhanced Logging:** Debug logging for command input validation and session mode detection.

### Fixed
- Session reordering issue where active input would cause sessions to jump to top of list.
- Docker container networking isolation - implemented HTTP proxy bridge for cross-host session access.
- WSL agent process stability - ensured auto-restart via systemd service.

### Changed
- Default session sort from "Activity" to "Created" for better UX stability.
- SSH tunnel configuration now uses structured logging in server.ts.

## [0.1.20] - 2026-03-15

### Added
- **Multi-Socket Discovery:** SshTmuxProvider now iterates through `/tmp/tmux-*/default` sockets for flexible tmux setup.
- **HTTP Remote Provider:** HttpRemoteProvider class for REST API-based session discovery from WSL agent.
- **WSL HTTP Agent:** Node.js HTTP server on WSL port 3001 exposing tmux sessions via `/api/sessions` endpoint.
- **Old Tmux Compatibility:** Fallback from `-F` format flag to simple `tmux ls` parsing for tmux versions that don't support formatting.
- **Environment Variable Flexibility:** Support for both monolithic and individual WORK_OS_HOSTS_* environment variables.

### Fixed
- tmux session list formatting for old tmux versions (HVU).
- SSH command execution reliability by passing remote commands as single strings.
- PTY allocation for SSH connections using `-t` flag consistently.

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
