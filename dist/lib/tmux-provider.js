"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MultiHostSessionPool = exports.HttpRemoteProvider = void 0;
exports.resolveTmuxProvider = resolveTmuxProvider;
exports.resetTmuxProvider = resetTmuxProvider;
exports.buildSessionPool = buildSessionPool;
exports.resetSessionPool = resetSessionPool;
const child_process_1 = require("child_process");
// ---------------------------------------------------------------------------
// Concrete strategies
// ---------------------------------------------------------------------------
class DefaultSocketProvider {
    constructor() {
        this.socketPath = undefined;
        this.hostId = 'local';
        this.displayName = 'Local';
        this.providerType = 'local';
    }
    exec(args) {
        return (0, child_process_1.execFileSync)('tmux', args, { encoding: 'utf-8' }).trim();
    }
    isAvailable() {
        try {
            (0, child_process_1.execFileSync)('tmux', ['ls'], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
            return true;
        }
        catch (e) {
            const msg = e.stderr || e.message || '';
            // "no server running" means tmux binary works and socket is writable — just no sessions yet
            return msg.includes('no server running');
        }
    }
}
class ExplicitSocketProvider {
    constructor(socketPath) {
        this.socketPath = socketPath;
        this.hostId = 'local';
        this.displayName = 'Local';
        this.providerType = 'local';
    }
    exec(args) {
        return (0, child_process_1.execFileSync)('tmux', ['-S', this.socketPath, ...args], { encoding: 'utf-8' }).trim();
    }
    isAvailable() {
        try {
            (0, child_process_1.execFileSync)('tmux', ['-S', this.socketPath, 'ls'], {
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            return true;
        }
        catch (e) {
            const msg = e.stderr || e.message || '';
            if (msg.includes('no server running'))
                return true;
            // Socket path doesn't exist or can't connect
            return false;
        }
    }
}
/**
 * SSH-based tmux provider for remote hosts.
 * Runs tmux commands over SSH to access remote sessions.
 */
class SshTmuxProvider {
    constructor(hostId, displayName, sshTarget, // "opa@host" or "opa@host -p PORT"
    remoteSocketPath, sshOpts = [
        '-o',
        'BatchMode=yes',
        '-o',
        'ConnectTimeout=5',
        '-o',
        'ControlMaster=auto',
        '-o',
        'ControlPath=/tmp/ssh-wos-%r@%h:%p',
        '-o',
        'ControlPersist=60',
        '-o',
        'StrictHostKeyChecking=accept-new',
    ]) {
        this.hostId = hostId;
        this.displayName = displayName;
        this.sshOpts = sshOpts;
        this.providerType = 'ssh';
        this.sshExtraOpts = [];
        // Parse sshTarget for port specification: "user@host -p PORT"
        const parts = sshTarget.split(' ');
        this.sshTarget = parts[0]; // user@host
        if (parts.length > 1) {
            this.sshExtraOpts = parts.slice(1); // -p PORT or other options
        }
        this.socketPath = remoteSocketPath;
    }
    exec(args) {
        // Special handling for 'ls' command: fetch from all tmux sockets
        if (args[0] === 'ls') {
            return this.execListAllSockets(args);
        }
        // Standard execution for other commands (using configured socket)
        const tmuxArgs = ['tmux', '-S', this.socketPath, ...args]
            .map((arg) => `'${arg.replace(/'/g, "'\\''")}'`)
            .join(' ');
        // Pass remote command as a single string argument to ssh
        const remoteCmd = `bash -c "TERM=xterm ${tmuxArgs}"`;
        const cmd = ['ssh', ...this.sshOpts, ...this.sshExtraOpts, this.sshTarget, remoteCmd];
        return (0, child_process_1.execFileSync)(cmd[0], cmd.slice(1), { encoding: 'utf-8' }).trim();
    }
    /**
     * Execute list-sessions across all available tmux sockets on the remote host
     */
    execListAllSockets(args) {
        const formatArg = args[args.length - 1];
        // Properly escape formatArg for bash (single-quote safe)
        const escapedFormat = formatArg.replace(/'/g, "'\\''");
        // Build a bash script that:
        // 1. Finds all tmux sockets
        // 2. Lists sessions from each socket
        // 3. Aggregates results
        const bashScript = `
      for sock in /tmp/tmux-*/default; do
        if [ -S "$sock" ]; then
          tmux -S "$sock" ls -F '${escapedFormat}' 2>/dev/null || true
        fi
      done
    `.trim();
        const escapedScript = bashScript.replace(/'/g, "'\\''");
        const remoteCmd = `bash -c "TERM=xterm bash -c '${escapedScript}'"`;
        const cmd = ['ssh', ...this.sshOpts, ...this.sshExtraOpts, this.sshTarget, remoteCmd];
        try {
            return (0, child_process_1.execFileSync)(cmd[0], cmd.slice(1), { encoding: 'utf-8' }).trim();
        }
        catch (error) {
            // If multi-socket approach fails, fall back to single socket
            console.warn(`[tmux-provider] multi-socket list failed, falling back to single socket`);
            const tmuxArgs = ['tmux', '-S', this.socketPath, ...args]
                .map((arg) => `'${arg.replace(/'/g, "'\\''")}'`)
                .join(' ');
            const fallbackCmd = `bash -c "TERM=xterm ${tmuxArgs}"`;
            const fallbackExecCmd = ['ssh', ...this.sshOpts, ...this.sshExtraOpts, this.sshTarget, fallbackCmd];
            return (0, child_process_1.execFileSync)(fallbackExecCmd[0], fallbackExecCmd.slice(1), { encoding: 'utf-8' }).trim();
        }
    }
    isAvailable() {
        try {
            (0, child_process_1.execFileSync)('ssh', [...this.sshOpts, this.sshTarget, 'tmux', '-V'], {
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            return true;
        }
        catch (_a) {
            return false;
        }
    }
}
/**
 * HTTP-based tmux provider for remote agents (e.g., WSL agent).
 * Communicates via HTTP API instead of SSH.
 */
class HttpRemoteProvider {
    constructor(hostId, displayName, agentUrl // e.g., "http://172.29.214.157:3001"
    ) {
        this.hostId = hostId;
        this.displayName = displayName;
        this.socketPath = undefined;
        this.providerType = 'http';
        this.agentUrl = agentUrl;
    }
    /**
     * Make HTTP request to the agent using curl (synchronous)
     */
    httpRequest(method, path, body) {
        const url = this.agentUrl + path;
        const args = ['-sf'];
        if (method === 'POST') {
            args.push('-X', 'POST');
            args.push('-H', 'Content-Type: application/json');
            if (body) {
                args.push('-d', JSON.stringify(body));
            }
        }
        args.push(url);
        try {
            const result = (0, child_process_1.execFileSync)('curl', args, { encoding: 'utf-8', timeout: 5000 });
            return result;
        }
        catch (error) {
            throw new Error(`HTTP request failed: ${error.message}`);
        }
    }
    exec(args) {
        // Map tmux commands to HTTP API calls
        if (args[0] === 'ls' && args[1] === '-F') {
            // List sessions
            const response = this.httpRequest('GET', '/api/sessions');
            const parsed = JSON.parse(response);
            return parsed.sessions
                .map((s) => {
                return [
                    s.name,
                    s.created,
                    s.isAttached ? '1' : '0',
                    s.command || '',
                    s.directory || '',
                    s.role || '',
                    s.instructionPath || '',
                ].join('__WORKOS__');
            })
                .join('\n');
        }
        if (args[0] === 'display-message' && args[1] === '-p') {
            // Get session info
            const sessionName = args[args.indexOf('-t') + 1];
            const response = this.httpRequest('GET', `/api/sessions/${sessionName}`);
            const parsed = JSON.parse(response);
            const format = args[args.length - 1];
            if (format.includes('session_name')) {
                return `${parsed.name}|${parsed.isAttached ? 1 : 0}|${parsed.currentCommand}|${parsed.currentPath}`;
            }
            return '';
        }
        if (args[0] === 'capture-pane') {
            // Capture terminal content
            const sessionName = args[args.indexOf('-t') + 1];
            const response = this.httpRequest('GET', `/api/sessions/${sessionName}/capture`);
            const parsed = JSON.parse(response);
            return parsed.content || '';
        }
        if (args[0] === 'send-keys') {
            // Send keys to session
            const sessionName = args[args.indexOf('-t') + 1];
            const keyIndex = args.indexOf('-l') !== -1 ? args.indexOf('-l') + 2 : args.length - 1;
            const key = args[keyIndex];
            if (args.includes('-l')) {
                this.httpRequest('POST', `/api/sessions/${sessionName}/send-literal`, { text: key });
            }
            else {
                this.httpRequest('POST', `/api/sessions/${sessionName}/send-key`, { key });
            }
            return '';
        }
        // For other commands, we can't map them
        throw new Error(`HttpRemoteProvider does not support tmux ${args[0]} command`);
    }
    isAvailable() {
        // HTTP providers are available if configured (network checks happen at runtime)
        return true;
    }
}
exports.HttpRemoteProvider = HttpRemoteProvider;
/**
 * Manages multiple TmuxProvider instances across multiple hosts.
 * Provides composite session IDs in the format "hostId:sessionName".
 */
class MultiHostSessionPool {
    constructor(providers) {
        this.providers = new Map();
        for (const provider of providers) {
            this.providers.set(provider.hostId, provider);
        }
    }
    /**
     * Resolve a composite session ID to its provider and session name.
     * Format: "hostId:sessionName" or just "sessionName" (defaults to "local").
     */
    resolve(compositeId) {
        const [maybeHostId, ...rest] = compositeId.split(':');
        let hostId = 'local';
        let sessionName = compositeId;
        if (rest.length > 0) {
            hostId = maybeHostId;
            sessionName = rest.join(':');
        }
        const provider = this.providers.get(hostId);
        if (!provider) {
            throw new Error(`host not found: ${hostId}`);
        }
        return { provider, sessionName };
    }
    /**
     * List all sessions from all available hosts.
     */
    listAll(executor) {
        const result = [];
        for (const [hostId, provider] of this.providers) {
            try {
                const sessions = executor(provider);
                result.push({
                    hostId,
                    displayName: provider.displayName,
                    sessions,
                });
            }
            catch (error) {
                console.warn(`[tmux] failed to list sessions on ${hostId}:`, error instanceof Error ? error.message : error);
            }
        }
        return result;
    }
    /**
     * Get a provider by host ID.
     */
    getProvider(hostId) {
        return this.providers.get(hostId);
    }
    /**
     * Get all providers.
     */
    getAllProviders() {
        return Array.from(this.providers.values());
    }
}
exports.MultiHostSessionPool = MultiHostSessionPool;
// ---------------------------------------------------------------------------
// Auto-resolution
// ---------------------------------------------------------------------------
function candidateSocketPaths() {
    const paths = [];
    try {
        const uid = (0, child_process_1.execSync)('id -u', { encoding: 'utf-8' }).trim();
        paths.push(`/tmp/tmux-${uid}/default`);
    }
    catch (_a) {
        // ignore
    }
    for (const uid of ['1000', '0']) {
        const p = `/tmp/tmux-${uid}/default`;
        if (!paths.includes(p))
            paths.push(p);
    }
    return paths;
}
let _resolved = null;
let _pool = null;
/**
 * Resolve the best TmuxProvider for the current environment.
 *
 * Resolution order:
 *  1. TMUX_SOCKET env var (explicit opt-in, e.g. Docker bind-mount)
 *  2. tmux default socket (local dev, most common)
 *  3. Common socket paths under /tmp/tmux-<uid>/default (Docker auto-discovery)
 *
 * The result is cached for the lifetime of the process.
 */
function resolveTmuxProvider() {
    if (_resolved)
        return _resolved;
    const envSocket = process.env.TMUX_SOCKET;
    if (envSocket) {
        _resolved = new ExplicitSocketProvider(envSocket);
        return _resolved;
    }
    const defaultProvider = new DefaultSocketProvider();
    if (defaultProvider.isAvailable()) {
        _resolved = defaultProvider;
        return _resolved;
    }
    for (const socketPath of candidateSocketPaths()) {
        const provider = new ExplicitSocketProvider(socketPath);
        if (provider.isAvailable()) {
            console.log(`[tmux] auto-resolved socket: ${socketPath}`);
            _resolved = provider;
            return _resolved;
        }
    }
    // Nothing worked — return default anyway so callers get a real error message
    console.warn('[tmux] no working socket found; falling back to default');
    _resolved = defaultProvider;
    return _resolved;
}
/** Bust the cached provider (useful in tests or when TMUX_SOCKET changes at runtime). */
function resetTmuxProvider() {
    _resolved = null;
}
/**
 * Build a MultiHostSessionPool from environment configuration.
 *
 * WORK_OS_HOSTS env var (JSON array):
 * [
 *   { "hostId": "local", "displayName": "HVU Local", "type": "local" },
 *   { "hostId": "wsl", "displayName": "WSL", "type": "ssh",
 *     "sshTarget": "opa@172.x.x.x", "socketPath": "/tmp/tmux-1000/default" }
 * ]
 *
 * Falls back to single local provider if not configured.
 */
function buildSessionPool() {
    if (_pool)
        return _pool;
    const hostsEnv = process.env.WORK_OS_HOSTS;
    if (hostsEnv) {
        try {
            const hostsConfig = JSON.parse(hostsEnv);
            const providers = [];
            for (const config of hostsConfig) {
                if (config.type === 'local') {
                    if (config.socketPath) {
                        providers.push(new ExplicitSocketProvider(config.socketPath));
                    }
                    else {
                        providers.push(resolveTmuxProvider());
                    }
                }
                else if (config.type === 'ssh') {
                    providers.push(new SshTmuxProvider(config.hostId, config.displayName, config.sshTarget, config.socketPath));
                }
                else if (config.type === 'http') {
                    providers.push(new HttpRemoteProvider(config.hostId, config.displayName, config.agentUrl));
                }
            }
            if (providers.length > 0) {
                _pool = new MultiHostSessionPool(providers);
                console.log(`[tmux-pool] initialized with ${providers.length} host(s)`);
                return _pool;
            }
        }
        catch (error) {
            console.warn('[tmux-pool] failed to parse WORK_OS_HOSTS:', error instanceof Error ? error.message : error);
        }
    }
    // Fallback: single local provider
    _pool = new MultiHostSessionPool([resolveTmuxProvider()]);
    return _pool;
}
/** Bust the cached pool (useful in tests). */
function resetSessionPool() {
    _pool = null;
}
