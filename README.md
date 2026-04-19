[日本語版](README-ja.md)

# work-os

Browser-based tmux operations console — **Next.js 16 + Express 5 + Socket.IO.**

Supervise and interact with multiple tmux sessions from one dashboard. Aggregates sessions from multiple hosts (SSH, HTTP agent), streams terminal output over WebSocket, and can auto-respond to agent prompts via the Commander Agent.

> **work-os** = your operating surface for AI agents running in tmux. One tab to see everything.

**Docs**: [Architecture](docs/architecture.md) | [Getting Started](docs/getting-started.md) | [Security](docs/security.md)

**日本語**: [アーキテクチャ](docs/architecture-ja.md) | [Getting Started](docs/getting-started-ja.md) | [セキュリティ](docs/security-ja.md)

---

> **SECURITY WARNING** — work-os ships with **no authentication**. The API is open and `cors: { origin: true }` is set in Socket.IO. Never expose this service to the internet without additional protection (e.g. Cloudflare Tunnel + Access). See [docs/security.md](docs/security.md).

---

## Table of Contents

- [What It Does](#what-it-does)
- [Stack](#stack)
- [Quick Start](#quick-start)
- [Multi-Host Setup](#multi-host-setup)
- [Commander Agent](#commander-agent)
- [Terminal Modes](#terminal-modes)
- [Known Issues](#known-issues)

---

## What It Does

- Monitors multiple tmux sessions from one dashboard
- Streams live terminal output via Socket.IO (PTY attach or mirror capture)
- Aggregates sessions from multiple hosts: local, SSH remotes, HTTP agent bridge
- Sorts sessions by creation time, activity, or name
- Launches new agent sessions with command, working directory, and template
- Opens child shell sessions in the same working directory
- Lists and detaches tmux clients per session
- **Commander Agent**: attaches an autonomous session that auto-responds to `y/n` and numbered prompts in a target session

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router) + React 19 |
| Backend | Express 5 custom server (`src/server.ts`) |
| Real-time | Socket.IO 4 over HTTP |
| Terminal render | xterm.js 5 + fit addon |
| PTY bridge | node-pty |
| Multiplexer | host tmux (socket bind-mount or SSH) |
| Multi-host | `MultiHostSessionPool` — local / SSH / HTTP providers |

> **Note**: Both `next.config.js` and `next.config.ts` exist in the repository. `next.config.js` (`module.exports`) is the active configuration; `next.config.ts` is a stub left over from scaffold generation and is effectively inert. The duplicate should be removed to avoid confusion.

---

## Quick Start

### Local development

```bash
cd /home/opa/work/work-os
npm install
PORT=4311 npm run dev
```

Open `http://127.0.0.1:4311`.

### Docker

```bash
cd /home/opa/work/work-os
docker compose up -d --build
```

Open `http://127.0.0.1:3000`.

The Docker container bind-mounts:

| Container path | Host path | Purpose |
|---|---|---|
| `/usr/local/bin/tmux` | host tmux binary | Version match |
| `/tmp/tmux-1000` | host tmux socket dir | Socket access |
| `/app/src` | `./src` | Live code reload |
| `/app/public` | `./public` | Static assets |
| `/app/templates` | `./templates` | Session templates |

The container does **not** run its own tmux server — it connects to the host socket. Terminating the container does not kill any tmux sessions.

---

## Multi-Host Setup

work-os can aggregate sessions from multiple hosts. Configure via the `WORK_OS_HOSTS` environment variable (JSON array):

```yaml
# docker-compose.yml
environment:
  WORK_OS_HOSTS: |
    [
      { "hostId": "local", "displayName": "Local", "type": "local" },
      { "hostId": "wsl",   "displayName": "WSL",   "type": "ssh",
        "sshTarget": "opa@172.29.214.157",
        "socketPath": "/tmp/tmux-1000/default" },
      { "hostId": "rpi",   "displayName": "Pi",    "type": "http",
        "agentUrl": "http://192.168.1.80:3001" }
    ]
```

Session IDs take the form `hostId:sessionName` (e.g. `wsl:claude-work`).

See [docs/getting-started.md](docs/getting-started.md) for full setup instructions.

---

## Commander Agent

The Commander Agent attaches an autonomous session to a target session and auto-responds to prompts.

1. Click **[⚔️ Add Commander]** on any session card.
2. Enter a commander name and optionally select a template.
3. Click **Launch**.

The commander polls the target every 5 seconds. When it detects a `y/n` prompt, a numbered selection, or a shell prompt, it sends the appropriate key.

**Interrupt**: type anything in the commander session to pause auto-responses for 30 seconds.

> **WARNING** — The Commander Agent has no input whitelist. It will auto-respond to any matching prompt pattern in the target session, including destructive commands. Use only with sessions you fully control. See [docs/security.md](docs/security.md).

Use cases:
- Auto-approve file-edit confirmations during long Claude Code runs
- Handle routine `y/n` prompts in CI/CD workflows

---

## Terminal Modes

| Mode | Description | Best for |
|---|---|---|
| `auto` | work-os chooses attach vs mirror | Default |
| `attach` | Live PTY attach to tmux | Shell sessions |
| `resize-client` | PTY attach + window resize sync | Shell sessions needing size sync |
| `mirror` | `capture-pane` poll every 400 ms | Agent / TUI sessions |
| `readonly-mirror` | Mirror with input disabled | Read-only observation |

Mirror mode is safer when a session is already attached elsewhere. PTY mode gives lower latency for interactive shells.

---

## Known Issues

- **`next.config.js` / `next.config.ts` duplicate** — both files exist; `next.config.js` wins. The `.ts` stub should be deleted.
- **No authentication** — all API endpoints and the Socket.IO connection are unauthenticated. See [docs/security.md](docs/security.md).
- **Commander Agent whitelist absent** — the agent responds to any matching prompt pattern; no per-session allow-list exists.
- **Mirror mode cursor** — `capture-pane` output does not preserve cursor position; complex TUI cursor rendering may be off.
