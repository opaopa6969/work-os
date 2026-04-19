[日本語版](getting-started-ja.md)

# Getting Started

This guide covers initial setup and multi-host configuration.

---

## Prerequisites

- Node.js 20+
- tmux installed on the host machine
- (For Docker mode) Docker + Docker Compose

---

## Local Development

### 1. Install dependencies

```bash
cd /home/opa/work/work-os
npm install
```

### 2. Start the server

```bash
PORT=4311 npm run dev
```

The `dev` script runs `ts-node --project tsconfig.server.json src/server.ts`, which starts Express 5 + Socket.IO and then boots Next.js in development mode.

### 3. Open the dashboard

```
http://127.0.0.1:4311
```

work-os auto-discovers the local tmux socket using the following order:
1. `TMUX_SOCKET` env var (explicit)
2. Default tmux socket (usually `/tmp/tmux-<uid>/default`)
3. Common paths: `/tmp/tmux-1000/default`, `/tmp/tmux-0/default`

---

## Docker

### 1. Start

```bash
cd /home/opa/work/work-os
docker compose up -d --build
```

### 2. Open the dashboard

```
http://127.0.0.1:3000
```

### 3. Required bind-mounts

The container needs access to the host tmux socket. The `docker-compose.yml` includes:

```yaml
volumes:
  - /usr/local/bin/tmux:/usr/local/bin/tmux:ro   # version match
  - /tmp/tmux-1000:/tmp/tmux-1000                # socket dir
  - ./src:/app/src
  - ./public:/app/public
  - ./templates:/app/templates
```

Set `TMUX_SOCKET=/tmp/tmux-1000/default` in the container environment.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4000` | HTTP port |
| `TMUX_SOCKET` | (auto) | Explicit tmux socket path |
| `WORK_OS_HOSTS` | (local only) | JSON array of host configurations |
| `NODE_ENV` | `development` | Set to `production` for the built server |

---

## Multi-Host Configuration

work-os can aggregate sessions from multiple machines. Configure via `WORK_OS_HOSTS` (a JSON array).

### Supported provider types

| Type | Transport | Use case |
|---|---|---|
| `local` | Direct tmux socket | Same machine or Docker bind-mount |
| `ssh` | SSH + tmux over the wire | Remote Linux / WSL host |
| `http` | HTTP REST to a work-os agent | Hosts where SSH is not available |

### Single local host (default)

No configuration needed. work-os auto-resolves the local socket.

### Local + SSH remote

```yaml
# docker-compose.yml
environment:
  WORK_OS_HOSTS: |
    [
      {
        "hostId": "local",
        "displayName": "Local",
        "type": "local"
      },
      {
        "hostId": "wsl",
        "displayName": "WSL",
        "type": "ssh",
        "sshTarget": "opa@172.29.214.157",
        "socketPath": "/tmp/tmux-1000/default"
      }
    ]
```

#### SSH prerequisites

The work-os container (or process) must be able to SSH to the remote host without a password prompt.

```bash
# Inside the container, generate a key
ssh-keygen -t ed25519 -f /root/.ssh/id_ed25519 -N ""
cat /root/.ssh/id_ed25519.pub
# Add the output to ~/.ssh/authorized_keys on the remote host
```

`SshTmuxProvider` uses ControlMaster multiplexing by default:

```
BatchMode=yes
ConnectTimeout=5
ControlMaster=auto
ControlPath=/tmp/ssh-wos-%r@%h:%p
ControlPersist=60
StrictHostKeyChecking=accept-new
```

### Local + HTTP agent

For hosts that cannot be reached by SSH directly (e.g. a Docker container reaching a WSL host behind NAT):

1. **Run the work-os HTTP agent** on the remote machine:

   ```bash
   # On the remote host / WSL
   cd /home/opa/work/work-os
   PORT=3001 npm run dev:agent
   ```

   The agent exposes `GET /api/sessions`, `GET /api/sessions/:id`, `POST /api/sessions/:id/send-literal`, etc.

2. **Configure the HTTP provider**:

   ```yaml
   WORK_OS_HOSTS: |
     [
       { "hostId": "local", "displayName": "Local", "type": "local" },
       { "hostId": "wsl",   "displayName": "WSL",   "type": "http",
         "agentUrl": "http://172.29.214.157:3001" }
     ]
   ```

> **Security note**: The HTTP agent has no authentication. It must only be accessible on a private/trusted network.

### Alternative: individual env vars

Instead of the JSON array you can use individual vars:

```bash
WORK_OS_HOSTS_HVU='{"hostId":"hvu","displayName":"HVU","type":"local"}'
WORK_OS_HOSTS_WSL='{"hostId":"wsl","displayName":"WSL","type":"ssh","sshTarget":"opa@172.x.x.x","socketPath":"/tmp/tmux-1000/default"}'
```

---

## Verifying the Setup

```bash
# Check the health endpoint
curl http://localhost:4311/healthz
# { "ok": true, "sessions": 2, "pty": 1, "mirror": 1, "remote-websocket": 0 }

# Verify tmux sessions are visible
curl http://localhost:4311/api/sessions | jq '.sessions[].id'
```

---

## Creating Your First Session

From the dashboard:

1. Fill in the **Launch** form: name, command (e.g. `claude`), working directory.
2. Click **Launch**.
3. The new session appears in the list. Click its terminal card to connect.

Or via API:

```bash
curl -X POST http://localhost:4311/api/sessions \
  -H 'Content-Type: application/json' \
  -d '{"name":"claude-work","command":"claude","cwd":"/home/opa/work"}'
```

---

## Next Steps

- [Architecture](architecture.md) — understand how the bridge and provider system works
- [Security](security.md) — **read before exposing to any network**
