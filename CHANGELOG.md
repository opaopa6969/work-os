# Changelog

All notable changes to work-os are documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Planned
- Authentication middleware (session token or API key)
- Commander Agent input whitelist / per-session allow-list
- Remove `next.config.ts` stub (duplicate of `next.config.js`)

---

## [0.1.21] - 2026-03-15

### Added
- **Commander Agent** — attach an autonomous "commander" session to any target session for automatic prompt response
  - Detects `(y/n)`, numbered selection (`1. Allow`, `2. Deny`), and shell prompts via 5-second polling
  - `AutoAcceptManager` (`src/lib/auto-accept.ts`) manages per-commander poll timers
  - `SessionStore` (`src/lib/session-store.ts`) tracks commander↔target relationships
  - REST endpoints `POST /api/sessions/:id/auto-accept` (enable) and `DELETE` (disable)
  - Session cards show role badges (`commander` / `target`) and linked session ID
  - Modal UI for creating commanders with optional template selection
- **Session Sort Controls** — dropdown to sort sessions by Created, Activity, or Name; default is Created for stable ordering
- **Multi-Host Session Discovery** — unified `GET /api/sessions` returns sessions from all configured hosts in one response
- **HTTP Agent Bridge** — `HttpRemoteProvider` communicates with a remote Node.js HTTP agent via REST; enables Docker → WSL routing without direct SSH
- **Remote WebSocket Bridge** — `ensureRemoteWebSocketBridge()` proxies Socket.IO terminal streams through the HTTP agent
- **Enhanced session logging** — command input validation and mode-detection debug logs in `server.ts`

### Fixed
- Session reordering during active input (default sort changed to Created)
- Docker container networking isolation via HTTP proxy bridge for cross-host access
- WSL agent process stability via systemd service

### Changed
- Default session sort order: Activity → Created

---

## [0.1.20] - 2026-03-15

### Added
- **Multi-Socket Discovery** — `SshTmuxProvider` iterates `/tmp/tmux-*/default` sockets on the remote host
- **`HttpRemoteProvider`** — REST API-based session discovery from WSL agent; maps tmux subcommands to HTTP calls
- **WSL HTTP Agent** — Node.js server on WSL port 3001 exposing `GET /api/sessions` and related endpoints
- **Old tmux Compatibility** — fallback from `-F` format flag to simple `tmux ls` line parsing for older tmux versions
- **`WORK_OS_HOSTS_*` env vars** — individual `WORK_OS_HOSTS_HVU` / `WORK_OS_HOSTS_WSL` as alternative to the monolithic JSON array

### Fixed
- tmux session list formatting on older HVU tmux versions
- SSH command execution reliability (remote command passed as single string to `bash -c`)
- PTY allocation for SSH connections (`-t` flag applied consistently)

---

## [0.1.0] - 2026-03-09

### Added
- **Hybrid Architecture** — control plane in Docker, data plane (agents) on host/WSL via tmux socket sharing
- **Commander Dashboard** — bird's-eye view of all active sessions with real-time status and quick controls
- **Auto-Yes** — automatic detection and response to `(y/n)` prompts per session setting
- **Enter Shell** — one-click to open a new bash session in the same directory as an existing agent
- **ANSI Color Support** — full-color terminal rendering via `ansi-to-html`
- **i18n Help System** — guide and UI available in Japanese and English
- **Mobile-First Responsive UI** — single-column layout optimized for mobile control
- **Cloudflare Tunnel Integration** — `cloudflared` support for `unlaxer.org` remote access
- **Custom Agent Launcher** — UI to start new tmux sessions with custom commands and working directories
- **Session Modes** — `auto`, `mirror`, `readonly-mirror`, `attach`, `resize-client`

### Fixed
- Command reliability via `spawnSync` for tmux interactions
- Input lag via per-session refresh
- Terminal preview layout issues
