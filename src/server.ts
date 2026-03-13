import express from 'express';
import { createServer } from 'http';
import next from 'next';
import { Server } from 'socket.io';
import * as pty from 'node-pty';
import { spawnSync } from 'child_process';
import { resolveTmuxProvider } from './lib/tmux-provider';

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

process.on('uncaughtException', (error) => {
  console.error('[Server] Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Server] Unhandled Rejection:', reason);
});

const tmuxProvider = resolveTmuxProvider();
const getTmuxArgs = (args: string[]) =>
  tmuxProvider.socketPath ? ['-S', tmuxProvider.socketPath, ...args] : args;

type SessionMode = 'pty' | 'mirror';
type SessionModePreference = 'auto' | 'mirror' | 'readonly-mirror' | 'attach' | 'resize-client';

type SessionInfo = {
  sessionId: string;
  attachedCount: number;
  currentCommand: string;
  currentPath: string;
  mode: SessionMode;
  reason: string;
  resizeStrategy: 'pty-only' | 'tmux-window';
  readOnly: boolean;
};

type PtyBridge = {
  sessionId: string;
  mode: 'pty';
  ptyProcess: pty.IPty;
  sockets: Set<string>;
  createdAt: number;
  lastActiveAt: number;
  resizeStrategy: 'pty-only' | 'tmux-window';
  readOnly: boolean;
};

type MirrorBridge = {
  sessionId: string;
  mode: 'mirror';
  sockets: Set<string>;
  createdAt: number;
  lastActiveAt: number;
  pollTimer: NodeJS.Timeout;
  lastSnapshot: string;
  info: SessionInfo;
  resizeStrategy: 'pty-only' | 'tmux-window';
  readOnly: boolean;
};

type Bridge = PtyBridge | MirrorBridge;

const bridges = new Map<string, Bridge>();
const socketToSession = new Map<string, string>();

function sanitizeSessionId(input: unknown) {
  return String(input || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 120);
}

function tmuxOutput(args: string[]) {
  return tmuxProvider.exec(args);
}

function getSessionInfo(sessionId: string, preferredMode: SessionModePreference = 'auto'): SessionInfo {
  const output = tmuxOutput([
    'display-message',
    '-p',
    '-t',
    sessionId,
    '#{session_name}|#{session_attached}|#{pane_current_command}|#{pane_current_path}',
  ]);
  const [resolvedSessionId, attachedText, currentCommandRaw, currentPathRaw] = output.split('|');
  const currentCommand = (currentCommandRaw || '').trim();
  const currentPath = (currentPathRaw || '').trim();
  const attachedCount = Number.parseInt(attachedText || '0', 10) || 0;
  const lowerCommand = currentCommand.toLowerCase();
  const isShellCommand = ['bash', 'sh', 'zsh', 'fish'].includes(lowerCommand);
  const isChildShell = resolvedSessionId.startsWith('sh-');
  const detectedMode: SessionMode = attachedCount > 0 || (!isShellCommand && !isChildShell) ? 'mirror' : 'pty';
  const mode: SessionMode =
    preferredMode === 'mirror' || preferredMode === 'readonly-mirror'
      ? 'mirror'
      : preferredMode === 'attach' || preferredMode === 'resize-client'
        ? 'pty'
        : detectedMode;
  const reason =
    preferredMode !== 'auto'
      ? `forced-${preferredMode}`
      : attachedCount > 0
      ? 'already-attached'
      : isChildShell
        ? 'shell-child'
        : isShellCommand
          ? 'shell-session'
          : 'agent-session';

  const resizeStrategy =
    preferredMode === 'resize-client'
      ? 'tmux-window'
      : 'pty-only';
  const readOnly = preferredMode === 'readonly-mirror';

  return {
    sessionId: resolvedSessionId,
    attachedCount,
    currentCommand,
    currentPath,
    mode,
    reason,
    resizeStrategy,
    readOnly,
  };
}

function captureSession(sessionId: string) {
  try {
    const alt = tmuxOutput(['capture-pane', '-a', '-e', '-J', '-p', '-t', sessionId]);
    if (alt) {
      return alt;
    }
  } catch {
  }

  try {
    return tmuxOutput(['capture-pane', '-e', '-J', '-p', '-t', sessionId]);
  } catch {
    return '';
  }
}

function sendMirrorData(sessionId: string, data: string) {
  const chunks: Array<{ literal?: string; key?: string }> = [];
  let buffer = '';
  let index = 0;

  const flushBuffer = () => {
    if (!buffer) {
      return;
    }
    chunks.push({ literal: buffer });
    buffer = '';
  };

  while (index < data.length) {
    const next = data.slice(index);
    if (next.startsWith('\u001b[A')) {
      flushBuffer();
      chunks.push({ key: 'Up' });
      index += 3;
      continue;
    }
    if (next.startsWith('\u001b[B')) {
      flushBuffer();
      chunks.push({ key: 'Down' });
      index += 3;
      continue;
    }
    if (next.startsWith('\u001b[C')) {
      flushBuffer();
      chunks.push({ key: 'Right' });
      index += 3;
      continue;
    }
    if (next.startsWith('\u001b[D')) {
      flushBuffer();
      chunks.push({ key: 'Left' });
      index += 3;
      continue;
    }

    const char = data[index];
    if (char === '\r') {
      flushBuffer();
      chunks.push({ key: 'Enter' });
    } else if (char === '\u007f') {
      flushBuffer();
      chunks.push({ key: 'BSpace' });
    } else if (char === '\t') {
      flushBuffer();
      chunks.push({ key: 'Tab' });
    } else if (char === '\u0003') {
      flushBuffer();
      chunks.push({ key: 'C-c' });
    } else if (char === '\u001b') {
      flushBuffer();
      chunks.push({ key: 'Escape' });
    } else if (char >= ' ' || char === '\n') {
      buffer += char === '\n' ? '\r' : char;
    }
    index += 1;
  }

  flushBuffer();

  for (const chunk of chunks) {
    if (chunk.literal) {
      spawnSync('tmux', getTmuxArgs(['send-keys', '-l', '-t', sessionId, chunk.literal]), { encoding: 'utf-8' });
      continue;
    }
    if (chunk.key) {
      spawnSync('tmux', getTmuxArgs(['send-keys', '-t', sessionId, chunk.key]), { encoding: 'utf-8' });
    }
  }
}

function ensurePtyBridge(io: Server, info: SessionInfo, cols: number, rows: number) {
  const existing = bridges.get(info.sessionId);
  if (existing && existing.mode === 'pty') {
    existing.lastActiveAt = Date.now();
    if (cols > 0 && rows > 0) {
      try {
        existing.ptyProcess.resize(cols, rows);
      } catch {
      }
    }
    return existing;
  }

  const ptyProcess = pty.spawn('tmux', getTmuxArgs(['attach-session', '-t', info.sessionId]), {
    name: process.env.TERM || 'xterm-256color',
    cols: cols > 0 ? cols : 120,
    rows: rows > 0 ? rows : 32,
    cwd: info.currentPath || process.cwd(),
    env: {
      ...process.env,
      TERM: process.env.TERM || 'xterm-256color',
      COLORTERM: 'truecolor',
    } as Record<string, string>,
  });

  const bridge: PtyBridge = {
    sessionId: info.sessionId,
    mode: 'pty',
    ptyProcess,
    sockets: new Set(),
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    resizeStrategy: info.resizeStrategy,
    readOnly: false,
  };

  ptyProcess.onData((data) => {
    bridge.lastActiveAt = Date.now();
    for (const socketId of bridge.sockets) {
      io.to(socketId).emit('output', data);
    }
  });

  ptyProcess.onExit(({ exitCode, signal }) => {
    for (const socketId of bridge.sockets) {
      io.to(socketId).emit('session-exit', { sessionId: info.sessionId, exitCode, signal });
      socketToSession.delete(socketId);
    }
    bridges.delete(info.sessionId);
  });

  bridges.set(info.sessionId, bridge);
  return bridge;
}

function destroyBridge(sessionId: string) {
  const existing = bridges.get(sessionId);
  if (!existing) {
    return;
  }

  if (existing.mode === 'mirror') {
    clearInterval(existing.pollTimer);
  } else {
    try {
      existing.ptyProcess.kill();
    } catch {
    }
  }

  for (const socketId of existing.sockets) {
    socketToSession.delete(socketId);
  }
  bridges.delete(sessionId);
}

function ensureMirrorBridge(io: Server, info: SessionInfo) {
  const existing = bridges.get(info.sessionId);
  if (existing && existing.mode === 'mirror') {
    existing.lastActiveAt = Date.now();
    existing.info = info;
    return existing;
  }

  const bridge: MirrorBridge = {
    sessionId: info.sessionId,
    mode: 'mirror',
    sockets: new Set(),
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    pollTimer: setInterval(() => {
      try {
        const snapshot = captureSession(info.sessionId);
        if (snapshot === bridge.lastSnapshot) {
          return;
        }
        bridge.lastSnapshot = snapshot;
        bridge.lastActiveAt = Date.now();
        for (const socketId of bridge.sockets) {
          io.to(socketId).emit('terminal:snapshot', {
            sessionId: info.sessionId,
            data: snapshot,
          });
        }
      } catch (error) {
        for (const socketId of bridge.sockets) {
          io.to(socketId).emit('terminal:error', {
            sessionId: info.sessionId,
            message: error instanceof Error ? error.message : 'failed to capture session',
          });
        }
      }
    }, 400),
    lastSnapshot: '',
    info,
    resizeStrategy: info.resizeStrategy,
    readOnly: info.readOnly,
  };

  bridges.set(info.sessionId, bridge);
  return bridge;
}

function detachSocket(socketId: string) {
  const sessionId = socketToSession.get(socketId);
  if (!sessionId) {
    return;
  }

  const bridge = bridges.get(sessionId);
  if (bridge) {
    bridge.sockets.delete(socketId);
    bridge.lastActiveAt = Date.now();
    if (bridge.sockets.size === 0 && bridge.mode === 'mirror') {
      clearInterval(bridge.pollTimer);
      bridges.delete(sessionId);
    }
  }

  socketToSession.delete(socketId);
}

app
  .prepare()
  .then(() => {
    const server = express();
    const httpServer = createServer(server);
    const io = new Server(httpServer, {
      path: '/socket.io',
      cors: {
        origin: true,
        credentials: true,
      },
    });

    io.on('connection', (socket) => {
      socket.emit('terminal:status', {
        state: 'connected',
        message: 'socket connected',
      });

      socket.on('start', (payload: { sessionId?: string; cols?: number; rows?: number; preferredMode?: SessionModePreference }) => {
        const sessionId = sanitizeSessionId(payload?.sessionId);
        const cols = Number(payload?.cols || 0);
        const rows = Number(payload?.rows || 0);
        const preferredMode: SessionModePreference =
          payload?.preferredMode === 'mirror' ||
          payload?.preferredMode === 'readonly-mirror' ||
          payload?.preferredMode === 'attach' ||
          payload?.preferredMode === 'resize-client'
            ? payload.preferredMode
            : 'auto';

        if (!sessionId) {
          socket.emit('terminal:error', { message: 'sessionId is required' });
          return;
        }

        detachSocket(socket.id);

        try {
          const info = getSessionInfo(sessionId, preferredMode);
          const existing = bridges.get(info.sessionId);
          if (
            existing &&
            (existing.mode !== info.mode ||
              existing.resizeStrategy !== info.resizeStrategy ||
              existing.readOnly !== info.readOnly)
          ) {
            destroyBridge(info.sessionId);
          }
          const bridge =
            info.mode === 'mirror'
              ? ensureMirrorBridge(io, info)
              : ensurePtyBridge(io, info, cols, rows);
          bridge.sockets.add(socket.id);
          bridge.lastActiveAt = Date.now();
          socketToSession.set(socket.id, info.sessionId);

          socket.emit('terminal:status', {
            state: 'ready',
            sessionId: info.sessionId,
            message: `${info.mode.toUpperCase()}: ${info.reason}`,
            readOnly: info.readOnly,
          });

          if (info.mode === 'mirror') {
            io.to(socket.id).emit('terminal:snapshot', {
              sessionId: info.sessionId,
              data: captureSession(info.sessionId),
            });
          }
        } catch (error) {
          socket.emit('terminal:error', {
            sessionId,
            message: error instanceof Error ? error.message : 'failed to attach terminal',
          });
        }
      });

      socket.on('command', (payload: { data?: string }) => {
        const sessionId = socketToSession.get(socket.id);
        if (!sessionId) {
          return;
        }
        const bridge = bridges.get(sessionId);
        if (!bridge) {
          return;
        }
        bridge.lastActiveAt = Date.now();
        const data = String(payload?.data || '');
        if (bridge.readOnly) {
          return;
        }
        if (bridge.mode === 'pty') {
          bridge.ptyProcess.write(data);
          return;
        }
        sendMirrorData(sessionId, data);
      });

      socket.on('resize', (payload: { cols?: number; rows?: number }) => {
        const sessionId = socketToSession.get(socket.id);
        if (!sessionId) {
          return;
        }
        const bridge = bridges.get(sessionId);
        if (!bridge) {
          return;
        }
        const cols = Number(payload?.cols || 0);
        const rows = Number(payload?.rows || 0);
        if (cols <= 0 || rows <= 0) {
          return;
        }
        bridge.lastActiveAt = Date.now();
        if (bridge.mode === 'pty') {
          try {
            bridge.ptyProcess.resize(cols, rows);
          } catch {
          }
          if (bridge.resizeStrategy === 'tmux-window') {
            spawnSync('tmux', getTmuxArgs(['resize-window', '-t', sessionId, '-x', String(cols), '-y', String(rows)]), {
              encoding: 'utf-8',
            });
          }
          return;
        }
        spawnSync('tmux', getTmuxArgs(['resize-window', '-t', sessionId, '-x', String(cols), '-y', String(rows)]), {
          encoding: 'utf-8',
        });
      });

      socket.on('disconnect', () => {
        detachSocket(socket.id);
      });
    });

    server.get('/healthz', (_req, res) => {
      const counts = Array.from(bridges.values()).reduce(
        (acc, bridge) => {
          acc[bridge.mode] += 1;
          return acc;
        },
        { pty: 0, mirror: 0 },
      );
      res.json({ ok: true, sessions: bridges.size, ...counts });
    });

    server.all('*all', (req, res) => handle(req, res));

    const PORT = Number(process.env.PORT) || 4000;
    httpServer.listen(PORT, '0.0.0.0', () => {
      console.log(`> Ready on http://0.0.0.0:${PORT}`);
    });
  })
  .catch((error) => {
    console.error('>>> [Server] Fatal Error during Next.js prepare:', error);
    process.exit(1);
  });
