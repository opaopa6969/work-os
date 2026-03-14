"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = require("http");
const next_1 = __importDefault(require("next"));
const socket_io_1 = require("socket.io");
const pty = __importStar(require("node-pty"));
const socket_io_client_1 = require("socket.io-client");
const tmux_provider_1 = require("./lib/tmux-provider");
const dev = process.env.NODE_ENV !== 'production';
const app = (0, next_1.default)({ dev });
const handle = app.getRequestHandler();
process.on('uncaughtException', (error) => {
    console.error('[Server] Uncaught Exception:', error);
});
process.on('unhandledRejection', (reason) => {
    console.error('[Server] Unhandled Rejection:', reason);
});
const sessionPool = (0, tmux_provider_1.buildSessionPool)();
const bridges = new Map();
const socketToSession = new Map();
function sanitizeSessionId(input) {
    return String(input || '')
        .trim()
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .slice(0, 120);
}
function getSessionInfo(provider, sessionName, preferredMode = 'auto') {
    const output = provider.exec([
        'display-message',
        '-p',
        '-t',
        sessionName,
        '#{session_name}|#{session_attached}|#{pane_current_command}|#{pane_current_path}',
    ]);
    const [resolvedSessionId, attachedText, currentCommandRaw, currentPathRaw] = output.split('|');
    const currentCommand = (currentCommandRaw || '').trim();
    const currentPath = (currentPathRaw || '').trim();
    const attachedCount = Number.parseInt(attachedText || '0', 10) || 0;
    const lowerCommand = currentCommand.toLowerCase();
    const isShellCommand = ['bash', 'sh', 'zsh', 'fish'].includes(lowerCommand);
    const isChildShell = resolvedSessionId.startsWith('sh-');
    const detectedMode = attachedCount > 0 || (!isShellCommand && !isChildShell) ? 'mirror' : 'pty';
    const mode = preferredMode === 'mirror' || preferredMode === 'readonly-mirror'
        ? 'mirror'
        : preferredMode === 'attach' || preferredMode === 'resize-client'
            ? 'pty'
            : detectedMode;
    const reason = preferredMode !== 'auto'
        ? `forced-${preferredMode}`
        : attachedCount > 0
            ? 'already-attached'
            : isChildShell
                ? 'shell-child'
                : isShellCommand
                    ? 'shell-session'
                    : 'agent-session';
    const resizeStrategy = preferredMode === 'resize-client'
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
function captureSession(provider, sessionName) {
    try {
        const alt = provider.exec(['capture-pane', '-a', '-e', '-J', '-p', '-t', sessionName]);
        if (alt) {
            return alt;
        }
    }
    catch (_a) {
    }
    try {
        return provider.exec(['capture-pane', '-e', '-J', '-p', '-t', sessionName]);
    }
    catch (_b) {
        return '';
    }
}
function sendMirrorData(provider, sessionName, data) {
    const chunks = [];
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
        }
        else if (char === '\u007f') {
            flushBuffer();
            chunks.push({ key: 'BSpace' });
        }
        else if (char === '\t') {
            flushBuffer();
            chunks.push({ key: 'Tab' });
        }
        else if (char === '\u0003') {
            flushBuffer();
            chunks.push({ key: 'C-c' });
        }
        else if (char === '\u001b') {
            flushBuffer();
            chunks.push({ key: 'Escape' });
        }
        else if (char >= ' ' || char === '\n') {
            buffer += char === '\n' ? '\r' : char;
        }
        index += 1;
    }
    flushBuffer();
    for (const chunk of chunks) {
        if (chunk.literal) {
            provider.exec(['send-keys', '-l', '-t', sessionName, chunk.literal]);
            continue;
        }
        if (chunk.key) {
            provider.exec(['send-keys', '-t', sessionName, chunk.key]);
        }
    }
}
function ensurePtyBridge(io, provider, info, cols, rows) {
    const compositeId = `${provider.hostId}:${info.sessionId}`;
    const existing = bridges.get(compositeId);
    if (existing && existing.mode === 'pty') {
        existing.lastActiveAt = Date.now();
        if (cols > 0 && rows > 0) {
            try {
                existing.ptyProcess.resize(cols, rows);
            }
            catch (_a) {
            }
        }
        return existing;
    }
    // For SSH providers, spawn ssh; for local, spawn tmux directly
    const isLocal = provider.hostId === 'local';
    let ptyProcess;
    if (isLocal) {
        ptyProcess = pty.spawn('tmux', ['attach-session', '-t', info.sessionId], {
            name: process.env.TERM || 'xterm-256color',
            cols: cols > 0 ? cols : 120,
            rows: rows > 0 ? rows : 32,
            cwd: info.currentPath || process.cwd(),
            env: Object.assign(Object.assign({}, process.env), { TERM: process.env.TERM || 'xterm-256color', COLORTERM: 'truecolor' }),
        });
    }
    else {
        // SSH provider - cwd must be a valid path in the container, not on the remote host
        const sshProvider = provider;
        const sshTarget = sshProvider.sshTarget;
        const socketPath = provider.socketPath || '/tmp/tmux-1000/default';
        ptyProcess = pty.spawn('ssh', ['-t', sshTarget, 'tmux', '-S', socketPath, 'attach-session', '-t', info.sessionId], {
            name: process.env.TERM || 'xterm-256color',
            cols: cols > 0 ? cols : 120,
            rows: rows > 0 ? rows : 32,
            cwd: process.cwd(),
            env: Object.assign(Object.assign({}, process.env), { TERM: process.env.TERM || 'xterm-256color', COLORTERM: 'truecolor' }),
        });
    }
    const bridge = {
        sessionId: compositeId,
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
            io.to(socketId).emit('session-exit', { sessionId: compositeId, exitCode, signal });
            socketToSession.delete(socketId);
        }
        bridges.delete(compositeId);
    });
    bridges.set(compositeId, bridge);
    return bridge;
}
function destroyBridge(sessionId) {
    const existing = bridges.get(sessionId);
    if (!existing) {
        return;
    }
    if (existing.mode === 'mirror') {
        clearInterval(existing.pollTimer);
    }
    else if (existing.mode === 'pty') {
        try {
            existing.ptyProcess.kill();
        }
        catch (_a) {
        }
    }
    else if (existing.mode === 'remote-websocket') {
        try {
            existing.remoteSocket.disconnect();
        }
        catch (_b) {
        }
    }
    for (const socketId of existing.sockets) {
        socketToSession.delete(socketId);
    }
    bridges.delete(sessionId);
}
function ensureMirrorBridge(io, provider, info) {
    const compositeId = `${provider.hostId}:${info.sessionId}`;
    const existing = bridges.get(compositeId);
    if (existing && existing.mode === 'mirror') {
        existing.lastActiveAt = Date.now();
        existing.info = info;
        return existing;
    }
    const bridge = {
        sessionId: compositeId,
        mode: 'mirror',
        sockets: new Set(),
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        pollTimer: setInterval(() => {
            try {
                const snapshot = captureSession(provider, info.sessionId);
                if (snapshot === bridge.lastSnapshot) {
                    return;
                }
                bridge.lastSnapshot = snapshot;
                bridge.lastActiveAt = Date.now();
                for (const socketId of bridge.sockets) {
                    io.to(socketId).emit('terminal:snapshot', {
                        sessionId: compositeId,
                        data: snapshot,
                    });
                }
            }
            catch (error) {
                for (const socketId of bridge.sockets) {
                    io.to(socketId).emit('terminal:error', {
                        sessionId: compositeId,
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
    bridges.set(compositeId, bridge);
    return bridge;
}
/**
 * Create a remote WebSocket bridge that proxies to an HTTP agent
 */
function ensureRemoteWebSocketBridge(io, provider, info) {
    const compositeId = `${provider.hostId}:${info.sessionId}`;
    const existing = bridges.get(compositeId);
    if (existing && existing.mode === 'remote-websocket') {
        existing.lastActiveAt = Date.now();
        existing.info = info;
        return existing;
    }
    // Create a remote socket connection to the agent
    const remoteSocket = (0, socket_io_client_1.io)(`${provider.agentUrl}`, {
        path: '/socket.io',
    });
    remoteSocket.on('connect', () => {
        // Send start command to remote agent
        remoteSocket.emit('start', {
            sessionId: info.sessionId,
            cols: 120,
            rows: 32,
        });
    });
    const bridge = {
        sessionId: compositeId,
        mode: 'remote-websocket',
        sockets: new Set(),
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        remoteSocket,
        info,
        resizeStrategy: info.resizeStrategy,
        readOnly: info.readOnly,
    };
    bridges.set(compositeId, bridge);
    return bridge;
}
function detachSocket(socketId) {
    const sessionId = socketToSession.get(socketId);
    if (!sessionId) {
        return;
    }
    const bridge = bridges.get(sessionId);
    if (bridge) {
        bridge.sockets.delete(socketId);
        bridge.lastActiveAt = Date.now();
        if (bridge.sockets.size === 0) {
            if (bridge.mode === 'mirror') {
                clearInterval(bridge.pollTimer);
                bridges.delete(sessionId);
            }
            else if (bridge.mode === 'remote-websocket') {
                bridge.remoteSocket.disconnect();
                bridges.delete(sessionId);
            }
        }
    }
    socketToSession.delete(socketId);
}
app
    .prepare()
    .then(() => {
    const server = (0, express_1.default)();
    const httpServer = (0, http_1.createServer)(server);
    const io = new socket_io_1.Server(httpServer, {
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
        socket.on('start', (payload) => {
            const compositeId = String((payload === null || payload === void 0 ? void 0 : payload.sessionId) || '').trim();
            const cols = Number((payload === null || payload === void 0 ? void 0 : payload.cols) || 0);
            const rows = Number((payload === null || payload === void 0 ? void 0 : payload.rows) || 0);
            const preferredMode = (payload === null || payload === void 0 ? void 0 : payload.preferredMode) === 'mirror' ||
                (payload === null || payload === void 0 ? void 0 : payload.preferredMode) === 'readonly-mirror' ||
                (payload === null || payload === void 0 ? void 0 : payload.preferredMode) === 'attach' ||
                (payload === null || payload === void 0 ? void 0 : payload.preferredMode) === 'resize-client'
                ? payload.preferredMode
                : 'auto';
            if (!compositeId) {
                socket.emit('terminal:error', { message: 'sessionId is required' });
                return;
            }
            detachSocket(socket.id);
            try {
                const { provider, sessionName } = sessionPool.resolve(compositeId);
                // For HTTP providers, use remote WebSocket bridge
                if (provider instanceof tmux_provider_1.HttpRemoteProvider) {
                    const bridgeKey = `${provider.hostId}:${sessionName}`;
                    const existing = bridges.get(bridgeKey);
                    if (existing && existing.mode !== 'remote-websocket') {
                        destroyBridge(bridgeKey);
                    }
                    // Create basic session info for remote bridge
                    const info = {
                        sessionId: sessionName,
                        attachedCount: 0,
                        currentCommand: '',
                        currentPath: '',
                        mode: 'pty',
                        reason: 'remote-websocket',
                        resizeStrategy: 'pty-only',
                        readOnly: false,
                    };
                    const bridge = ensureRemoteWebSocketBridge(io, provider, info);
                    bridge.sockets.add(socket.id);
                    bridge.lastActiveAt = Date.now();
                    socketToSession.set(socket.id, bridgeKey);
                    // Proxy events from remote to client
                    bridge.remoteSocket.on('output', (data) => {
                        socket.emit('output', data);
                    });
                    bridge.remoteSocket.on('session-exit', (payload) => {
                        socket.emit('session-exit', payload);
                        destroyBridge(bridgeKey);
                    });
                    bridge.remoteSocket.on('terminal:error', (payload) => {
                        socket.emit('terminal:error', payload);
                    });
                    bridge.remoteSocket.on('terminal:status', (payload) => {
                        socket.emit('terminal:status', payload);
                    });
                    socket.emit('terminal:status', {
                        state: 'ready',
                        sessionId: bridgeKey,
                        message: 'REMOTE: connected to HTTP agent',
                        readOnly: false,
                    });
                    return;
                }
                const info = getSessionInfo(provider, sessionName, preferredMode);
                const bridgeKey = `${provider.hostId}:${info.sessionId}`;
                const existing = bridges.get(bridgeKey);
                if (existing &&
                    (existing.mode !== info.mode ||
                        existing.resizeStrategy !== info.resizeStrategy ||
                        existing.readOnly !== info.readOnly)) {
                    destroyBridge(bridgeKey);
                }
                const bridge = info.mode === 'mirror'
                    ? ensureMirrorBridge(io, provider, info)
                    : ensurePtyBridge(io, provider, info, cols, rows);
                bridge.sockets.add(socket.id);
                bridge.lastActiveAt = Date.now();
                socketToSession.set(socket.id, bridgeKey);
                socket.emit('terminal:status', {
                    state: 'ready',
                    sessionId: bridgeKey,
                    message: `${info.mode.toUpperCase()}: ${info.reason}`,
                    readOnly: info.readOnly,
                });
                if (info.mode === 'mirror') {
                    io.to(socket.id).emit('terminal:snapshot', {
                        sessionId: bridgeKey,
                        data: captureSession(provider, info.sessionId),
                    });
                }
            }
            catch (error) {
                socket.emit('terminal:error', {
                    sessionId: compositeId,
                    message: error instanceof Error ? error.message : 'failed to attach terminal',
                });
            }
        });
        socket.on('command', (payload) => {
            const compositeId = socketToSession.get(socket.id);
            if (!compositeId) {
                return;
            }
            const bridge = bridges.get(compositeId);
            if (!bridge) {
                return;
            }
            bridge.lastActiveAt = Date.now();
            const data = String((payload === null || payload === void 0 ? void 0 : payload.data) || '');
            if (bridge.readOnly) {
                return;
            }
            if (bridge.mode === 'pty') {
                bridge.ptyProcess.write(data);
                return;
            }
            if (bridge.mode === 'remote-websocket') {
                bridge.remoteSocket.emit('command', { data });
                return;
            }
            // For mirror mode, we need to resolve the provider again
            const [hostId, sessionName] = compositeId.split(':');
            const provider = sessionPool.getProvider(hostId);
            if (!provider) {
                return;
            }
            sendMirrorData(provider, sessionName, data);
        });
        socket.on('resize', (payload) => {
            const compositeId = socketToSession.get(socket.id);
            if (!compositeId) {
                return;
            }
            const bridge = bridges.get(compositeId);
            if (!bridge) {
                return;
            }
            const cols = Number((payload === null || payload === void 0 ? void 0 : payload.cols) || 0);
            const rows = Number((payload === null || payload === void 0 ? void 0 : payload.rows) || 0);
            if (cols <= 0 || rows <= 0) {
                return;
            }
            bridge.lastActiveAt = Date.now();
            if (bridge.mode === 'pty') {
                // Resolve provider for tmux commands
                const [hostId, sessionName] = compositeId.split(':');
                const provider = sessionPool.getProvider(hostId);
                if (!provider) {
                    return;
                }
                try {
                    bridge.ptyProcess.resize(cols, rows);
                }
                catch (_a) {
                }
                if (bridge.resizeStrategy === 'tmux-window') {
                    provider.exec(['resize-window', '-t', sessionName, '-x', String(cols), '-y', String(rows)]);
                }
                return;
            }
            if (bridge.mode === 'remote-websocket') {
                bridge.remoteSocket.emit('resize', { cols, rows });
                return;
            }
            // Mirror mode
            const [hostId, sessionName] = compositeId.split(':');
            const provider = sessionPool.getProvider(hostId);
            if (!provider) {
                return;
            }
            provider.exec(['resize-window', '-t', sessionName, '-x', String(cols), '-y', String(rows)]);
        });
        socket.on('disconnect', () => {
            detachSocket(socket.id);
        });
    });
    server.get('/healthz', (_req, res) => {
        const counts = Array.from(bridges.values()).reduce((acc, bridge) => {
            acc[bridge.mode] += 1;
            return acc;
        }, { pty: 0, mirror: 0, 'remote-websocket': 0 });
        res.json(Object.assign({ ok: true, sessions: bridges.size }, counts));
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
