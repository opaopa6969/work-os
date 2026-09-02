import express from 'express';
import { createServer } from 'http';
import { execFileSync } from 'child_process';
import * as pty from 'node-pty';
import { Server } from 'socket.io';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  path: '/socket.io',
  cors: {
    origin: true,
    credentials: true,
  },
});

const AGENT_PORT = Number(process.env.AGENT_PORT) || 3001;
const TMUX_SOCKET = process.env.TMUX_SOCKET || '/tmp/tmux-1000/default';

// Store active PTY sessions.
// A bridge holds a single PTY process shared by every socket attached to the
// same session, so multiple browsers connecting to the same session reuse the
// existing PTY instead of overwriting it (mirrors src/server.ts PtyBridge).
type PtyBridge = {
  sessionName: string;
  ptyProcess: pty.IPty;
  sockets: Set<string>;
  createdAt: number;
  lastActiveAt: number;
};

const ptyBridges = new Map<string, PtyBridge>();
const socketToSession = new Map<string, string>();

/**
 * Execute tmux command locally
 */
function execTmux(args: string[]): string {
  return execFileSync('tmux', ['-S', TMUX_SOCKET, ...args], { encoding: 'utf-8' }).trim();
}

/**
 * Parse session information from tmux ls output
 */
function parseSessions(output: string) {
  return output
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, created, attached, command, directory, role, instructionPath] = line.split('__WORKOS__');
      return {
        name,
        created: Number(created),
        isAttached: attached === '1',
        command: command || '',
        directory: directory || '',
        role: role || '',
        instructionPath: instructionPath || '',
      };
    });
}

/**
 * Capture terminal content from a session
 */
function captureSession(sessionName: string): string {
  try {
    // Try with -a -e -J first (newer tmux)
    return execTmux(['capture-pane', '-a', '-e', '-J', '-p', '-t', sessionName]);
  } catch {
    // Fallback to basic capture
    try {
      return execTmux(['capture-pane', '-e', '-J', '-p', '-t', sessionName]);
    } catch {
      return '';
    }
  }
}

// ============================================================================
// HTTP Routes
// ============================================================================

app.use(express.json());

/**
 * GET /api/sessions - List all sessions
 */
app.get('/api/sessions', (req, res) => {
  try {
    const output = execTmux([
      'ls',
      '-F',
      '#{session_name}__WORKOS__#{session_created}__WORKOS__#{session_attached}__WORKOS__#{@workos_command}__WORKOS__#{@workos_directory}__WORKOS__#{@workos_role}__WORKOS__#{@workos_instruction_path}',
    ]);

    const sessions = parseSessions(output).map((session) => ({
      id: session.name,
      name: session.name,
      created: session.created,
      isAttached: session.isAttached,
      command: session.command,
      directory: session.directory,
      role: session.role,
      instructionPath: session.instructionPath,
    }));

    res.json({ sessions });
  } catch (error: any) {
    const message = error.message || '';
    if (message.includes('no server running')) {
      return res.json({ sessions: [] });
    }
    res.status(500).json({
      error: 'Failed to list sessions',
      details: message,
    });
  }
});

/**
 * GET /api/sessions/:id - Get session details
 */
app.get('/api/sessions/:id', (req, res) => {
  try {
    const sessionName = req.params.id;
    const output = execTmux([
      'display-message',
      '-p',
      '-t',
      sessionName,
      '#{session_name}|#{session_attached}|#{pane_current_command}|#{pane_current_path}',
    ]);

    const [name, attached, command, path] = output.split('|');
    res.json({
      id: name,
      name,
      isAttached: attached === '1',
      currentCommand: command,
      currentPath: path,
    });
  } catch (error: any) {
    res.status(404).json({
      error: 'Session not found',
      details: error.message,
    });
  }
});

/**
 * GET /api/sessions/:id/capture - Capture session content
 */
app.get('/api/sessions/:id/capture', (req, res) => {
  try {
    const sessionName = req.params.id;
    const content = captureSession(sessionName);
    res.json({ content });
  } catch (error: any) {
    res.status(404).json({
      error: 'Failed to capture session',
      details: error.message,
    });
  }
});

/**
 * POST /api/sessions/:id/send-key - Send key sequence to session
 */
app.post('/api/sessions/:id/send-key', (req, res) => {
  try {
    const sessionName = req.params.id;
    const { key } = req.body;

    if (!key) {
      return res.status(400).json({ error: 'key is required' });
    }

    execTmux(['send-keys', '-t', sessionName, key]);
    res.json({ ok: true });
  } catch (error: any) {
    res.status(404).json({
      error: 'Failed to send key',
      details: error.message,
    });
  }
});

/**
 * POST /api/sessions/:id/send-literal - Send literal text to session
 */
app.post('/api/sessions/:id/send-literal', (req, res) => {
  try {
    const sessionName = req.params.id;
    const { text } = req.body;

    if (text === undefined) {
      return res.status(400).json({ error: 'text is required' });
    }

    execTmux(['send-keys', '-l', '-t', sessionName, text]);
    res.json({ ok: true });
  } catch (error: any) {
    res.status(404).json({
      error: 'Failed to send literal',
      details: error.message,
    });
  }
});

// ============================================================================
// WebSocket Routes (via Socket.IO)
// ============================================================================

/**
 * Detach a single socket from its bridge. When the bridge has no remaining
 * sockets the underlying PTY is killed and the bridge is removed, mirroring
 * src/server.ts detachSocket().
 */
function detachSocket(socketId: string) {
  const sessionName = socketToSession.get(socketId);
  if (!sessionName) {
    return;
  }

  const bridge = ptyBridges.get(sessionName);
  if (bridge) {
    bridge.sockets.delete(socketId);
    bridge.lastActiveAt = Date.now();
    if (bridge.sockets.size === 0) {
      try {
        bridge.ptyProcess.kill();
      } catch {
        // PTY may already be dead
      }
      ptyBridges.delete(sessionName);
    }
  }

  socketToSession.delete(socketId);
}

io.on('connection', (socket) => {
  socket.emit('terminal:status', {
    state: 'connected',
    message: 'socket connected to WSL agent',
  });

  /**
   * start: Attach to a PTY for a session
   */
  socket.on('start', (payload: { sessionId?: string; cols?: number; rows?: number }) => {
    const sessionName = String(payload?.sessionId || '').trim();
    const cols = Number(payload?.cols || 0);
    const rows = Number(payload?.rows || 0);

    if (!sessionName) {
      socket.emit('terminal:error', { message: 'sessionId is required' });
      return;
    }

    // Detach from previous session if any
    const prevSessionId = socketToSession.get(socket.id);
    if (prevSessionId) {
      detachSocket(socket.id);
    }

    try {
      const existing = ptyBridges.get(sessionName);
      if (existing) {
        // Reuse the PTY already spawned for this session (multi-attach path).
        existing.sockets.add(socket.id);
        existing.lastActiveAt = Date.now();
        socketToSession.set(socket.id, sessionName);

        if (cols > 0 && rows > 0) {
          try {
            existing.ptyProcess.resize(cols, rows);
          } catch {
            // ignore resize errors
          }
        }

        socket.emit('terminal:status', {
          state: 'ready',
          sessionId: sessionName,
          message: 'PTY attached (shared)',
        });
        return;
      }

      // Spawn PTY for tmux attach-session
      const ptyProcess = pty.spawn('tmux', ['-S', TMUX_SOCKET, 'attach-session', '-t', sessionName], {
        name: process.env.TERM || 'xterm-256color',
        cols: cols > 0 ? cols : 120,
        rows: rows > 0 ? rows : 32,
        cwd: process.cwd(),
        env: {
          ...process.env,
          TERM: process.env.TERM || 'xterm-256color',
          COLORTERM: 'truecolor',
        } as Record<string, string>,
      });

      const bridge: PtyBridge = {
        sessionName,
        ptyProcess,
        sockets: new Set<string>([socket.id]),
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
      };
      ptyBridges.set(sessionName, bridge);
      socketToSession.set(socket.id, sessionName);

      // Broadcast PTY output to every attached socket
      ptyProcess.onData((data) => {
        bridge.lastActiveAt = Date.now();
        for (const socketId of bridge.sockets) {
          io.to(socketId).emit('output', data);
        }
      });

      // Handle exit
      ptyProcess.onExit(({ exitCode, signal }) => {
        for (const socketId of bridge.sockets) {
          io.to(socketId).emit('session-exit', { sessionId: sessionName, exitCode, signal });
          socketToSession.delete(socketId);
        }
        bridge.sockets.clear();
        ptyBridges.delete(sessionName);
      });

      socket.emit('terminal:status', {
        state: 'ready',
        sessionId: sessionName,
        message: 'PTY attached',
      });
    } catch (error: any) {
      socket.emit('terminal:error', {
        sessionId: sessionName,
        message: error instanceof Error ? error.message : 'failed to attach terminal',
      });
    }
  });

  /**
   * command: Send input to PTY
   */
  socket.on('command', (payload: { data?: string }) => {
    const sessionName = socketToSession.get(socket.id);
    if (!sessionName) {
      return;
    }

    const bridge = ptyBridges.get(sessionName);
    if (!bridge) {
      return;
    }

    bridge.lastActiveAt = Date.now();
    const data = String(payload?.data || '');
    bridge.ptyProcess.write(data);
  });

  /**
   * resize: Resize PTY
   */
  socket.on('resize', (payload: { cols?: number; rows?: number }) => {
    const sessionName = socketToSession.get(socket.id);
    if (!sessionName) {
      return;
    }

    const bridge = ptyBridges.get(sessionName);
    if (!bridge) {
      return;
    }

    const cols = Number(payload?.cols || 0);
    const rows = Number(payload?.rows || 0);

    if (cols > 0 && rows > 0) {
      bridge.lastActiveAt = Date.now();
      try {
        bridge.ptyProcess.resize(cols, rows);
        // Also resize tmux window
        execTmux(['resize-window', '-t', sessionName, '-x', String(cols), '-y', String(rows)]);
      } catch {
        // ignore resize errors
      }
    }
  });

  /**
   * disconnect: Clean up
   */
  socket.on('disconnect', () => {
    detachSocket(socket.id);
  });
});

// ============================================================================
// Health check
// ============================================================================

app.get('/healthz', (req, res) => {
  res.json({ ok: true, ptyBridges: ptyBridges.size });
});

// ============================================================================
// Start server
// ============================================================================

httpServer.listen(AGENT_PORT, '0.0.0.0', () => {
  console.log(`[WSL Agent] Ready on http://0.0.0.0:${AGENT_PORT}`);
  console.log(`[WSL Agent] TMUX_SOCKET=${TMUX_SOCKET}`);
});

process.on('uncaughtException', (error) => {
  console.error('[WSL Agent] Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('[WSL Agent] Unhandled Rejection:', reason);
});
