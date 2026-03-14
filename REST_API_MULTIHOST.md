# REST API-Based Multi-Host Session Management Implementation

## Overview

This implementation enables HVU (work-os server on port 3000) to manage TMux sessions on remote hosts (like WSL) via HTTP/REST APIs instead of SSH. This solves the network connectivity issue between HVU → WSL by leveraging HTTP which is more firewall-friendly than SSH.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Browser                                                     │
│ (WebSocket on :3000)                                        │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ HVU (work-os on :3000)                                      │
│                                                             │
│ • HTTP API routes                                           │
│ • Socket.IO server                                          │
│ • MultiHostSessionPool                                      │
│   - LocalTmuxProvider (local tmux)                          │
│   - SshTmuxProvider (local → remote SSH)                    │
│   - HttpRemoteProvider (HTTP → agent API)                   │
│                                                             │
│ • WebSocket Proxy Bridge (for HTTP providers)               │
└────────┬────────────────────────────────────────────────────┘
         │
         │ (1) HTTP GET  /api/sessions
         │ (2) HTTP POST /api/sessions/:id/send-key
         │ (3) WebSocket connect (proxy)
         ▼
┌─────────────────────────────────────────────────────────────┐
│ WSL Agent (on :3001)                                        │
│                                                             │
│ • HTTP API endpoints                                        │
│   - GET  /api/sessions                                      │
│   - GET  /api/sessions/:id                                  │
│   - GET  /api/sessions/:id/capture                          │
│   - POST /api/sessions/:id/send-key                         │
│   - POST /api/sessions/:id/send-literal                     │
│                                                             │
│ • Socket.IO server (/terminal/:sessionId)                   │
│   - PTY attachment                                          │
│   - Real-time terminal I/O                                  │
│                                                             │
│ • Local tmux execution                                      │
│   - Executes tmux commands directly on WSL                  │
│   - Spawns PTY for session attachment                       │
└─────────────────────────────────────────────────────────────┘
```

## Implementation Details

### Phase 1: WSL Agent (NEW)

**File**: `agent/index.ts`

A standalone HTTP + WebSocket server running on WSL (port 3001):

```bash
# Development
npm run dev:agent

# Production
npm run start:agent
```

**Endpoints**:

- `GET /api/sessions` - List all tmux sessions
- `GET /api/sessions/:id` - Get session details
- `GET /api/sessions/:id/capture` - Capture terminal content
- `POST /api/sessions/:id/send-key` - Send key sequence
- `POST /api/sessions/:id/send-literal` - Send literal text
- `WebSocket /socket.io` - PTY attachment

**Environment Variables**:
- `AGENT_PORT` (default: 3001)
- `TMUX_SOCKET` (default: /tmp/tmux-1000/default)

### Phase 2: HttpRemoteProvider

**File**: `src/lib/tmux-provider.ts`

New `HttpRemoteProvider` class implementing `TmuxProvider` interface:

```typescript
class HttpRemoteProvider implements TmuxProvider {
  providerType = 'http';

  exec(args: string[]): string {
    // Maps tmux commands to HTTP API calls
    // - 'ls -F' → GET /api/sessions
    // - 'display-message' → GET /api/sessions/:id
    // - 'capture-pane' → GET /api/sessions/:id/capture
    // - 'send-keys' → POST /api/sessions/:id/send-key
  }
}
```

Synchronous HTTP calls via `curl` (using `execFileSync`).

### Phase 3: Session Pool Configuration

**File**: `src/lib/tmux-provider.ts` - `buildSessionPool()`

Updated to support `type: 'http'` in `WORK_OS_HOSTS` configuration:

```json
[
  {
    "hostId": "local",
    "displayName": "HVU Local",
    "type": "local"
  },
  {
    "hostId": "wsl",
    "displayName": "WSL",
    "type": "http",
    "agentUrl": "http://172.29.214.157:3001"
  }
]
```

### Phase 4: WebSocket Proxy Bridge

**File**: `src/server.ts`

New `RemoteWebSocketBridge` type for proxying Socket.IO connections:

```typescript
type RemoteWebSocketBridge = {
  sessionId: string;
  mode: 'remote-websocket';
  remoteSocket: Socket; // Connection to agent
  sockets: Set<string>; // Connected clients
  // ... other fields
};
```

**Flow**:
1. Client connects to HVU socket.io with `{ sessionId: 'wsl:session-name' }`
2. Server detects HttpRemoteProvider
3. Creates `remoteSocket` connection to WSL agent
4. Proxies events:
   - `command` → remote `command`
   - `resize` → remote `resize`
   - Remote `output` → client `output`

### Phase 5: Build Configuration

**Files**:
- `package.json` - Added build scripts for agent
- `tsconfig.agent.json` - TypeScript config for agent

```bash
npm run build      # Builds Next.js + server + agent
npm run dev:agent  # Development: run WSL agent locally
npm run start:agent # Production: run WSL agent
```

## Setup Instructions

### On HVU (work-os container)

1. **Update environment** with WSL agent configuration:

```bash
export WORK_OS_HOSTS='[
  {
    "hostId": "local",
    "displayName": "HVU Local",
    "type": "local"
  },
  {
    "hostId": "wsl",
    "displayName": "WSL",
    "type": "http",
    "agentUrl": "http://172.29.214.157:3001"
  }
]'
```

2. **Start HVU server**:

```bash
npm run start
```

The server will initialize the session pool with both local and HTTP providers.

### On WSL

1. **Copy or download agent files**:

```bash
# Option A: Copy from HVU
docker cp work-os:/ path/to/work-os ~/work/work-os/

# Option B: Clone fresh
git clone <repo> ~/work/work-os/agent
```

2. **Install dependencies** (if not already present):

```bash
cd ~/work/work-os
npm install
```

3. **Start agent in WSL**:

```bash
# Development
npm run dev:agent

# Production (in container or systemd service)
npm run start:agent
```

The agent will:
- Listen on port 3001 (or `$AGENT_PORT`)
- Connect to local tmux socket (`$TMUX_SOCKET`)
- Log: `[WSL Agent] Ready on http://0.0.0.0:3001`

## Testing

### Step 1: Verify WSL Agent is Running

```bash
# From WSL or HVU
curl http://172.29.214.157:3001/healthz
# Should return: { "ok": true, "ptyBridges": 0 }
```

### Step 2: List Sessions from HVU

```bash
# From HVU
curl http://work-os:3000/api/sessions
# Should include sessions from both local and WSL
```

### Step 3: Test Dashboard

1. Open http://work-os:3000 in browser
2. Should see:
   - Local sessions (HVU)
   - WSL sessions (from agent)
3. Click on a WSL session
4. Terminal should connect and show output

### Step 4: Test Terminal Commands

In connected terminal:

```bash
echo "test"         # Should execute on WSL
ls -la            # Should work
# Output should appear in real-time
```

## Troubleshooting

### Agent not responding

```bash
# Check if agent is running
ps aux | grep 'node.*agent'

# Start agent manually with debug
DEBUG=* npm run dev:agent
```

### Sessions not appearing in dashboard

```bash
# Check agent API directly
curl http://172.29.214.157:3001/api/sessions

# Check HVU can reach agent
ssh opa@192.168.1.50 "curl http://172.29.214.157:3001/healthz"
```

### WebSocket connection fails

Check:
1. Agent is listening: `netstat -tlnp | grep 3001`
2. Firewall allows 3001: `ufw status` or Windows Defender
3. URL is correct in WORK_OS_HOSTS

### Terminal is frozen

1. Check agent logs: `npm run dev:agent`
2. Resize terminal: Ctrl+R (resize client)
3. Check tmux directly: `tmux -S /tmp/tmux-1000/default ls`

## Architecture Trade-offs

### Advantages

✅ **HTTP is firewall-friendly** - Easier than SSH across network segments
✅ **Bidirectional proxy** - Can reverse WSL → HVU in the future
✅ **REST API** - Can be extended for other client types (mobile, web)
✅ **Graceful degradation** - Supports local, SSH, and HTTP providers simultaneously
✅ **Minimal network changes** - Only requires agent to listen on port 3001

### Disadvantages

❌ **HTTP stateless by nature** - PTY session requires WebSocket proxy
❌ **Synchronous HTTP calls in exec()** - Blocks on session list operations
❌ **curl dependency** - Requires curl binary on HVU container
❌ **No encryption** - HTTP is plain text (use HTTPS in production)

## Future Enhancements

1. **HTTPS/TLS**: Configure certificates for production
2. **Agent authentication**: Add JWT/API key validation
3. **Agent discovery**: Auto-register agents on startup
4. **Performance**: Replace curl with native Node.js HTTP client
5. **Reverse proxy**: Allow WSL to connect back to HVU (firewall-friendly bi-directional)
6. **Session persistence**: Store session state in agent

## Known Limitations

1. **HTTP sync calls**: Session list operations are synchronous (blocking)
2. **No agent clustering**: Each agent is independent (can add load balancer later)
3. **PTY resize**: May have lag compared to local PTY
4. **Error handling**: Limited error messages from HTTP API

## Security Considerations

⚠️ **Production Requirements**:

1. **Use HTTPS** - Wrap with nginx/Caddy proxy
2. **API authentication** - Add JWT/key validation in agent
3. **Network isolation** - Place agent on private network segment
4. **Rate limiting** - Limit concurrent connections per session
5. **Logging** - Monitor all terminal commands

### Example Nginx Reverse Proxy

```nginx
upstream wsl_agent {
  server 172.29.214.157:3001;
}

server {
  listen 443 ssl http2;
  server_name wsl-agent.work-os;

  ssl_certificate /etc/ssl/certs/work-os.crt;
  ssl_certificate_key /etc/ssl/private/work-os.key;

  location / {
    proxy_pass http://wsl_agent;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```

## Files Changed

```
src/lib/tmux-provider.ts
  + HttpRemoteProvider class
  + TmuxProvider.providerType field
  + buildSessionPool() http type support

src/server.ts
  + RemoteWebSocketBridge type
  + ensureRemoteWebSocketBridge()
  + WebSocket proxy logic
  + socket.on('start') HTTP detection
  + socket.on('command') proxy
  + socket.on('resize') proxy
  + /healthz remote-websocket counts

agent/index.ts (NEW)
  + HTTP API endpoints
  + WebSocket PTY bridge
  + Session management

tsconfig.agent.json (NEW)
  + TypeScript config for agent build

package.json
  + dev:agent, start:agent scripts
  + ws dependency
```

## References

- [Socket.IO Client Documentation](https://socket.io/docs/v4/client-api/)
- [Node.js child_process.execFileSync](https://nodejs.org/api/child_process.html#child_process_child_process_execfilesync_file_arguments_options)
- [node-pty Documentation](https://github.com/microsoft/node-pty)
