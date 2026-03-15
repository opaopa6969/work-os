# Work OS API Documentation

## Sessions API

### Get All Sessions

```http
GET /api/sessions
```

**Response:**
```json
{
  "sessions": [
    {
      "id": "local:claude-session",
      "name": "claude-session",
      "hostId": "local",
      "hostName": "Local",
      "created": 1710000000,
      "isAttached": true,
      "command": "claude",
      "directory": "/home/user/project",
      "role": "standard",
      "instructionPath": "/tmp/workos-runtime/sessions/claude-session/AGENT.MD",
      "currentCommand": "claude",
      "currentPath": "/home/user/project",
      "clientCount": 1,
      "lastActivity": 1710000500,
      "suggestedMode": "mirror",
      "sessionRole": "regular",
      "linkedSessionId": null
    }
  ]
}
```

**Fields:**
- `id`: Composite session ID (format: `hostId:sessionName`)
- `name`: tmux session name
- `hostId`: Host identifier (e.g., "local", "hvu", "wsl")
- `hostName`: Human-readable host name
- `created`: Unix timestamp of session creation
- `isAttached`: Whether session has active tmux clients
- `command`: Original command used to start session
- `directory`: Working directory
- `role`: Session role from template (e.g., "standard", "commander")
- `currentCommand`: Currently executing command
- `currentPath`: Current working directory of pane
- `clientCount`: Number of attached tmux clients
- `lastActivity`: Unix timestamp of last activity
- `suggestedMode`: Recommended terminal mode (auto/mirror/attach)
- `sessionRole`: Commander agent role ("commander", "target", "regular")
- `linkedSessionId`: Linked session ID (for commander/target pairs)

### Create Session

```http
POST /api/sessions
Content-Type: application/json

{
  "name": "my-session",
  "command": "claude",
  "cwd": "/home/user/project",
  "templateName": "commander",
  "hostId": "local",
  "sessionRole": "commander",
  "linkedSessionId": "local:target-session"
}
```

**Request Parameters:**
- `name` (required): Session name (alphanumeric, `-`, `.`, `_`)
- `command` (required): Command to execute (e.g., "claude", "bash")
- `cwd` (required): Working directory path
- `templateName` (optional): Template name (will filter for `{template}-{lang}` pattern)
- `hostId` (optional): Host ID (default: "local")
- `sessionRole` (optional): "commander" or "target"
- `linkedSessionId` (optional): ID of linked session (required if sessionRole is set)

**Response:**
```json
{
  "message": "Session my-session started on Local",
  "compositeId": "local:my-session",
  "sessionName": "my-session",
  "hostId": "local",
  "cwd": "/home/user/project",
  "command": "claude",
  "instructionPath": "/tmp/workos-runtime/sessions/my-session/AGENT.MD",
  "sessionRole": "commander",
  "linkedSessionId": "local:target-session"
}
```

### Get Session Details

```http
GET /api/sessions/{sessionId}
```

**Parameters:**
- `sessionId`: Composite session ID (format: `hostId:sessionName`)

**Response:**
```json
{
  "content": "Terminal output content...",
  "isWaitingForInput": true,
  "sessionId": "local:claude-session",
  "mode": "mirror"
}
```

**Fields:**
- `content`: Current terminal screen content (ANSI codes included)
- `isWaitingForInput`: Boolean indicating if session is waiting for user input
- `sessionId`: The session ID
- `mode`: Current connection mode (pty/mirror)

### Send Key to Session

```http
POST /api/sessions/{sessionId}/send-key
Content-Type: application/json

{
  "key": "y"
}
```

**Parameters:**
- `sessionId`: Composite session ID
- `key`: Key or text to send (e.g., "y", "Enter", "C-c", "1\n")

**Response:**
```json
{
  "message": "Key sent"
}
```

### Kill Session

```http
DELETE /api/sessions/{sessionId}
```

**Response:**
```json
{
  "message": "Session terminated"
}
```

### Open Shell

```http
POST /api/sessions/{sessionId}/shell
```

**Parameters:**
- `sessionId`: Composite session ID

**Response:**
```json
{
  "newSession": "local:sh-claude-session-xyz123"
}
```

Creates a child shell session in the same working directory.

### List Clients

```http
GET /api/sessions/{sessionId}/clients
```

**Response:**
```json
{
  "raw": "tmux list-clients raw output",
  "clients": [
    {
      "raw": "/dev/pts/5  activity_timestamp",
      "name": "client-name",
      "pid": 1234,
      "tty": "/dev/pts/5",
      "size": "120x40",
      "created": 1710000000,
      "activity": 1710000500,
      "termname": "xterm-256color"
    }
  ]
}
```

### Kill Client

```http
POST /api/sessions/{sessionId}/clients/{tty}
```

**Parameters:**
- `sessionId`: Composite session ID
- `tty`: Client TTY path

**Response:**
```json
{
  "message": "Client killed"
}
```

---

## Commander Agent API

### Get Auto-Accept Status

```http
GET /api/sessions/{sessionId}/auto-accept
```

**Parameters:**
- `sessionId`: Commander session ID

**Response:**
```json
{
  "commanderSessionId": "local:commander-claude",
  "enabled": true,
  "targetSessionId": "local:claude",
  "role": "commander"
}
```

**Fields:**
- `enabled`: Whether auto-accept is currently active
- `targetSessionId`: The target session being monitored
- `role`: Session role

### Enable/Disable Auto-Accept

```http
POST /api/sessions/{sessionId}/auto-accept
Content-Type: application/json

{
  "enabled": true,
  "targetSessionId": "local:target-session"
}
```

**Parameters:**
- `sessionId`: Commander session ID
- `enabled` (required): Boolean to enable or disable
- `targetSessionId` (required when `enabled=true`): Target session ID

**Response (Enable):**
```json
{
  "message": "Auto-accept enabled",
  "commanderSessionId": "local:commander-claude",
  "targetSessionId": "local:target-session"
}
```

**Response (Disable):**
```json
{
  "message": "Auto-accept disabled",
  "commanderSessionId": "local:commander-claude"
}
```

**Errors:**
- 400: Missing required parameters
- 404: Session not found
- 500: Server error

---

## Templates API

### List Templates

```http
GET /api/templates
```

**Response:**
```json
{
  "templates": [
    {
      "name": "commander",
      "description": "CEO role. Manages and coordinates multiple agents."
    },
    {
      "name": "standard",
      "description": "General engineer covering design to release."
    }
  ]
}
```

### Initialize Template

```http
POST /api/templates
Content-Type: application/json

{
  "action": "init",
  "sourceLang": "en",
  "sourceSubDir": "standard"
}
```

**Parameters:**
- `action`: "init" or "duplicate"
- `sourceLang`: Language code ("en", "ja")
- `sourceSubDir`: Template subdirectory

### Duplicate Template

```http
POST /api/templates
Content-Type: application/json

{
  "action": "duplicate",
  "sourceName": "commander",
  "name": "commander-custom"
}
```

---

## WebSocket Events

### Connection

```
event: terminal:status
payload: {
  state: "connected" | "ready",
  message: string,
  sessionId?: string,
  readOnly?: boolean
}
```

### Terminal Output

```
event: output
payload: string (ANSI-escaped terminal output)
```

### Terminal Snapshot (Mirror Mode)

```
event: terminal:snapshot
payload: {
  sessionId: string,
  data: string (ANSI-escaped terminal content)
}
```

### Session Exit

```
event: session-exit
payload: {
  sessionId: string,
  exitCode: number,
  signal: string
}
```

### Error

```
event: terminal:error
payload: {
  sessionId: string,
  message: string
}
```

### Send Command

```
emit: command
payload: {
  data: string (text to send to session)
}
```

### Resize Terminal

```
emit: resize
payload: {
  cols: number,
  rows: number
}
```

---

## Error Responses

All error responses follow this format:

```json
{
  "error": "Error description",
  "details": "Additional error context"
}
```

**Status Codes:**
- 200: Success
- 400: Bad Request (invalid parameters)
- 404: Not Found (session not found)
- 500: Internal Server Error

---

## Examples

### Complete Workflow: Create and Link Commander

```bash
# 1. Create target session
curl -X POST http://localhost:4311/api/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-claude",
    "command": "claude",
    "cwd": "/home/user/project"
  }' | jq '.compositeId' -r

# Result: local:my-claude

# 2. Create commander session
curl -X POST http://localhost:4311/api/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "name": "commander-1",
    "command": "bash",
    "cwd": "/home/user/project",
    "sessionRole": "commander",
    "linkedSessionId": "local:my-claude"
  }' | jq '.compositeId' -r

# Result: local:commander-1

# 3. Enable auto-accept
curl -X POST http://localhost:4311/api/sessions/local:commander-1/auto-accept \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": true,
    "targetSessionId": "local:my-claude"
  }'

# 4. Check status
curl http://localhost:4311/api/sessions/local:commander-1/auto-accept

# 5. Disable when done
curl -X POST http://localhost:4311/api/sessions/local:commander-1/auto-accept \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}'
```

### Monitor All Active Commanders

```bash
curl http://localhost:4311/api/sessions | \
  jq '.sessions[] | select(.sessionRole == "commander") | {id, name, target: .linkedSessionId}'
```

---

## Rate Limits

- No explicit rate limiting currently implemented
- Recommended: 100 requests/minute per client

## Version

- Current Version: 0.1.21
- Last Updated: 2026-03-15
