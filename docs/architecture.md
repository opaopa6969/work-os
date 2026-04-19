[日本語版](architecture-ja.md)

# Architecture

work-os is a **hybrid control plane**: the web UI runs in Docker, the agents run on the host (or remote machines) in tmux. The two halves communicate through a shared tmux socket or SSH/HTTP.

---

## Overview

```
Browser
  │  HTTP (Next.js pages + API routes)
  │  WebSocket (Socket.IO — terminal stream)
  ▼
┌──────────────────────────────────────────┐
│  work-os process (Docker or local)       │
│                                          │
│  Next.js 16 (App Router)                 │
│    └─ src/app/api/**   REST endpoints    │
│                                          │
│  Express 5  (src/server.ts)              │
│    └─ Socket.IO 4      WS server         │
│    └─ /healthz         health check      │
│                                          │
│  MultiHostSessionPool                    │
│    ├─ LocalTmuxProvider   (socket)       │
│    ├─ SshTmuxProvider     (ssh)          │
│    └─ HttpRemoteProvider  (http)         │
└──────────┬──────────────────────────┬───┘
           │ socket bind-mount / SSH   │ HTTP REST
           ▼                          ▼
     host tmux                   remote agent
     /tmp/tmux-1000/default      :3001/api/sessions
```

---

## Component Responsibilities

### Next.js 16 (App Router)

- Serves the dashboard SPA (`src/app/page.tsx`)
- Exposes REST API routes under `src/app/api/sessions/`
  - `GET /api/sessions` — list all sessions across all hosts
  - `POST /api/sessions` — create a new tmux session
  - `GET /api/sessions/:id` — get session metadata
  - `DELETE /api/sessions/:id` — kill a session
  - `POST /api/sessions/:id/send-key` — send a raw key to a session
  - `POST /api/sessions/:id/shell` — open a child shell in the same directory
  - `GET /api/sessions/:id/clients` — list tmux clients
  - `POST /api/sessions/:id/auto-accept` — enable Commander auto-accept
- All routes are **unauthenticated** (see [security.md](security.md))

### Express 5 (`src/server.ts`)

- Wraps the Next.js request handler (`app.getRequestHandler()`)
- Mounts Socket.IO on the same HTTP server
- Owns the `bridges` Map — live terminal connections keyed by composite session ID
- Owns `socketToSession` Map — maps Socket.IO socket IDs to bridge keys
- Exposes `/healthz` returning bridge counts by mode

### Socket.IO 4 — WebSocket Transport

Socket.IO is used (not raw WebSocket) for automatic reconnection and fallback transport. The path is `/socket.io`.

**Client → Server events**:

| Event | Payload | Effect |
|---|---|---|
| `start` | `{ sessionId, cols, rows, preferredMode }` | Attach or create a bridge |
| `command` | `{ data }` | Forward keystrokes to the bridge |
| `resize` | `{ cols, rows }` | Resize the PTY or tmux window |

**Server → Client events**:

| Event | Payload | Meaning |
|---|---|---|
| `terminal:status` | `{ state, sessionId, message, readOnly }` | Connection ready / error |
| `output` | string | Raw terminal bytes (PTY mode) |
| `terminal:snapshot` | `{ sessionId, data }` | Full screen capture (mirror mode) |
| `terminal:error` | `{ sessionId, message }` | Error from the bridge |
| `session-exit` | `{ sessionId, exitCode, signal }` | PTY process exited |

CORS is set to `origin: true` (accept all origins). This is intentional for local/Docker use but **must not be exposed publicly without a front-end proxy that enforces origin**.

### MultiHostSessionPool (`src/lib/tmux-provider.ts`)

Maintains a map of `hostId → TmuxProvider`. Composite session IDs take the form `hostId:sessionName`.

**Provider types**:

| Type | Class | Transport |
|---|---|---|
| `local` | `DefaultSocketProvider` / `ExplicitSocketProvider` | `execFileSync('tmux', ...)` |
| `ssh` | `SshTmuxProvider` | `execFileSync('ssh', [..., 'tmux', ...])` |
| `http` | `HttpRemoteProvider` | `execFileSync('curl', ...)` → HTTP |

SSH uses ControlMaster multiplexing (`ControlPersist=60s`) to amortize connection overhead.

### WS Streaming — Bridge Types

Three bridge types live in `server.ts`:

**`PtyBridge`** (mode: `pty`)
- Spawns `node-pty` → `tmux attach-session -t <session>` (local) or `ssh -t <host> tmux attach-session` (remote SSH)
- Streams raw PTY bytes to all subscribed sockets via `output` events
- Resize: `ptyProcess.resize(cols, rows)` + optional `tmux resize-window` for `resize-client` mode
- Lifetime: persists until all sockets detach

**`MirrorBridge`** (mode: `mirror`)
- Polls `tmux capture-pane -a -e -J -p -t <session>` every 400 ms
- Emits `terminal:snapshot` only when the captured string changes
- Input: translates incoming key codes (arrows, Enter, Backspace, Tab, Ctrl-C) to `tmux send-keys` calls
- `readOnly: true` in `readonly-mirror` mode — input is silently dropped
- Lifetime: destroyed when last socket detaches

**`RemoteWebSocketBridge`** (mode: `remote-websocket`)
- Opens a Socket.IO client connection to the HTTP agent's Socket.IO server
- Proxies `output`, `session-exit`, `terminal:error`, `terminal:status` events bidirectionally
- Used when the provider is `HttpRemoteProvider`

### Commander Agent (`src/lib/auto-accept.ts` + `src/lib/session-store.ts`)

`SessionStore` holds in-memory commander↔target mappings.

`AutoAcceptManager` runs a `setInterval` (5 s) per active commander:
1. Captures the target session via `capture-pane`
2. Checks the last 1–2 lines for prompt patterns: `y/n`, `[Yy]/[Nn]`, `\d+\. `, `●`, `?$`, shell prompt `[$#>]`
3. If a prompt is detected, determines key: `1\n` for numbered "Allow/Yes" menus, `y\n` otherwise
4. Sends the key via `tmux send-keys`

**There is no whitelist.** Any session matching the pattern will receive an auto-response.

---

## Data Flow: Session List

```
Browser GET /api/sessions
  → Next.js route handler
    → sessionPool.listAll()
      → for each provider: provider.exec(['ls', '-F', <format>])
        local: execFileSync('tmux', ...)
        ssh:   execFileSync('ssh', [..., 'tmux', ...])
        http:  execFileSync('curl', ...) → /api/sessions on agent
      → parse __WORKOS__-delimited lines
    → merge results, attach host metadata
  → JSON response
```

## Data Flow: Terminal Session

```
Browser emits socket 'start' { sessionId: "local:main", cols: 220, rows: 50 }
  → server.ts socket handler
    → sessionPool.resolve("local:main") → { provider: LocalProvider, sessionName: "main" }
    → getSessionInfo(provider, "main", preferredMode) → { mode: "pty"|"mirror", ... }
    → ensurePtyBridge() or ensureMirrorBridge()
      PtyBridge: pty.spawn('tmux', ['attach-session', '-t', 'main'])
      MirrorBridge: setInterval(captureSession, 400)
    → bridge.sockets.add(socket.id)
    → emit 'terminal:status' { state: 'ready' }
    → [mirror] emit 'terminal:snapshot' with initial content

Browser emits socket 'command' { data: "ls\r" }
  → bridge.mode === 'pty': ptyProcess.write(data)
  → bridge.mode === 'mirror': sendMirrorData(provider, sessionName, data)
```

---

## File Map

```
src/
├── server.ts                    Express 5 + Socket.IO server + bridge logic
├── lib/
│   ├── tmux-provider.ts         TmuxProvider interface + all provider implementations
│   │                            MultiHostSessionPool, buildSessionPool()
│   ├── auto-accept.ts           AutoAcceptManager — Commander Agent polling
│   └── session-store.ts         SessionStore — commander↔target metadata
├── app/
│   ├── page.tsx                 Dashboard SPA
│   ├── layout.tsx               Root layout
│   └── api/sessions/
│       ├── route.ts             GET (list) / POST (create)
│       └── [id]/
│           ├── route.ts         GET (metadata) / DELETE (kill)
│           ├── send-key/        POST send-key
│           ├── shell/           POST open child shell
│           ├── clients/         GET list tmux clients
│           └── auto-accept/     POST enable / DELETE disable commander
├── components/
│   └── Terminal.tsx             xterm.js wrapper + Socket.IO client
next.config.js                   Active Next.js config (module.exports)
next.config.ts                   STUB — inert, should be deleted
```

---

## Known Architectural Limitations

| Issue | Impact | Mitigation |
|---|---|---|
| No authentication | Any network-reachable client can read/write sessions | Run behind Cloudflare Tunnel + Access, or local-only |
| `cors: origin: true` | Socket.IO accepts connections from any origin | Same as above |
| `next.config.js` / `.ts` duplicate | Potential confusion on which config is active | Delete `next.config.ts` |
| Commander Agent no whitelist | Auto-responds to any prompt in any linked session | Use only with trusted sessions |
| Mirror mode 400 ms poll | Slight lag; no cursor position from `capture-pane` | Use PTY mode for interactive sessions |
| HTTP agent no auth | REST endpoints on agent are open | Keep agent behind firewall / private network |
