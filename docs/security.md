[日本語版](security-ja.md)

# Security

> **Read this before exposing work-os to any network other than localhost.**

---

## Current State: No Authentication

work-os **ships with zero authentication**. This is a deliberate trade-off for personal/local use, but it has serious implications if the service is reachable from untrusted networks.

### What is exposed without authentication

| Surface | Exposure |
|---|---|
| `GET /api/sessions` | Lists all tmux session names, commands, working directories |
| `POST /api/sessions` | Creates new tmux sessions with arbitrary commands |
| `DELETE /api/sessions/:id` | Kills any tmux session by name |
| `POST /api/sessions/:id/send-key` | Sends arbitrary keystrokes to any session |
| `POST /api/sessions/:id/shell` | Opens a shell in any working directory |
| Socket.IO `command` event | Sends arbitrary input to any attached terminal |
| Socket.IO `start` event | Attaches to any tmux session by composite ID |

**Any client that can reach the work-os port can execute arbitrary commands on the host machine.**

### CORS: `origin: true`

Socket.IO is configured with:

```typescript
cors: {
  origin: true,   // accepts connections from ANY origin
  credentials: true,
}
```

This means a malicious web page visited by anyone on the same network can open a WebSocket to work-os and issue terminal commands. Do not run work-os on a shared or public network.

---

## HTTP Agent: Also Unauthenticated

The optional HTTP agent (`npm run dev:agent`) exposes tmux session management over REST with no authentication or rate limiting. It must only be reachable on a private, trusted network segment.

---

## Commander Agent: No Input Whitelist

The Commander Agent (`AutoAcceptManager`) will auto-respond to **any** session matching the prompt detection patterns:

- `y/n` patterns
- Numbered selection menus (e.g. `1. Allow`, `2. Deny`)
- Shell prompts (`$`, `#`, `>`)

There is no per-session whitelist, no pattern deny-list, and no human confirmation step. If you attach a commander to a session that runs destructive operations, the commander will approve them.

**Recommendation**: Only attach commanders to sessions you have reviewed and trust to run unattended.

---

## Safe Deployment Options

### Option 1: Cloudflare Tunnel + Access (recommended for remote access)

Cloudflare Tunnel exposes the local port without opening firewall rules. Cloudflare Access adds identity-based authentication in front of it.

```bash
# Install cloudflared
# https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/

cloudflared tunnel --url http://localhost:3000
```

With Cloudflare Access configured, only authenticated users (Google/GitHub/email OTP) can reach work-os. The service itself remains unauthenticated, but all traffic passes through Cloudflare's auth layer.

> **Note**: Cloudflare Access only protects HTTP requests. It does not protect WebSocket upgrades unless you explicitly configure Access policies for WebSocket paths.

### Option 2: Local-only (default, safest)

Bind only to localhost:

```bash
PORT=4311 npm run dev
# server listens on 0.0.0.0 by default — use a firewall to block external access
```

Or in `docker-compose.yml`:

```yaml
ports:
  - "127.0.0.1:3000:3000"   # bind to localhost only
```

### Option 3: VPN / private network

Run work-os only on a WireGuard or Tailscale network where all clients are trusted.

---

## Future Authentication Plans

Authentication has not been implemented yet. The planned approach is:

1. **Short-term**: Add a single shared secret (`WORK_OS_SECRET` env var) checked as a `Bearer` token on all API requests and as a Socket.IO handshake query parameter.
2. **Medium-term**: Session cookie issued after a simple passphrase login page — no external identity provider required.
3. **Long-term**: Integrate with an upstream proxy (e.g. Cloudflare Access, Authelia, or Authentik) rather than implementing auth in the application itself.

No timeline for these is committed.

---

## Summary Table

| Risk | Severity | Current mitigation |
|---|---|---|
| Unauthenticated REST API | Critical | Local-only or Cloudflare Tunnel + Access |
| `cors: origin: true` | High | Do not run on shared/public network |
| Commander Agent no whitelist | Medium | Use only with trusted sessions |
| HTTP agent no auth | High | Private network only |
| `next.config.ts` stub | Low | Cosmetic issue — delete the file |
| `typescript.ignoreBuildErrors: true` in next.config.js | Medium | TypeScript errors silently ignored at build time |
