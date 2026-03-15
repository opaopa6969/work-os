import { execFileSync, execSync } from 'child_process';

/**
 * Uniform interface for running tmux subcommands.
 * All implementations pass args as an array (no shell interpolation).
 */
export interface TmuxProvider {
  /** Execute a tmux subcommand and return trimmed stdout. */
  exec(args: string[]): string;
  /** Socket path being used, or undefined for the default socket. */
  readonly socketPath: string | undefined;
  /** Host identifier (e.g. "local", "wsl", "server1"). */
  readonly hostId: string;
  /** Human-readable display name (e.g. "HVU Local", "WSL", "Remote Server"). */
  readonly displayName: string;
  /** Provider type (used for routing logic) */
  readonly providerType?: 'local' | 'ssh' | 'http';
}

// ---------------------------------------------------------------------------
// Concrete strategies
// ---------------------------------------------------------------------------

class DefaultSocketProvider implements TmuxProvider {
  readonly socketPath = undefined;
  readonly hostId = 'local';
  readonly displayName = 'Local';
  readonly providerType = 'local' as const;

  exec(args: string[]): string {
    return execFileSync('tmux', args, { encoding: 'utf-8' }).trim();
  }

  isAvailable(): boolean {
    try {
      execFileSync('tmux', ['ls'], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      return true;
    } catch (e: any) {
      const msg: string = e.stderr || e.message || '';
      // "no server running" means tmux binary works and socket is writable — just no sessions yet
      return msg.includes('no server running');
    }
  }
}

class ExplicitSocketProvider implements TmuxProvider {
  readonly hostId = 'local';
  readonly displayName = 'Local';
  readonly providerType = 'local' as const;

  constructor(readonly socketPath: string) {}

  exec(args: string[]): string {
    return execFileSync('tmux', ['-S', this.socketPath, ...args], { encoding: 'utf-8' }).trim();
  }

  isAvailable(): boolean {
    try {
      execFileSync('tmux', ['-S', this.socketPath, 'ls'], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return true;
    } catch (e: any) {
      const msg: string = e.stderr || e.message || '';
      if (msg.includes('no server running')) return true;
      // Socket path doesn't exist or can't connect
      return false;
    }
  }
}

/**
 * SSH-based tmux provider for remote hosts.
 * Runs tmux commands over SSH to access remote sessions.
 */
class SshTmuxProvider implements TmuxProvider {
  readonly socketPath: string;
  readonly sshTarget: string; // Made public for server.ts access
  readonly providerType = 'ssh' as const;

  private sshExtraOpts: string[] = [];

  constructor(
    readonly hostId: string,
    readonly displayName: string,
    sshTarget: string, // "opa@host" or "opa@host -p PORT"
    remoteSocketPath: string,
    private readonly sshOpts: string[] = [
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
    ]
  ) {
    // Parse sshTarget for port specification: "user@host -p PORT"
    const parts = sshTarget.split(' ');
    this.sshTarget = parts[0]; // user@host
    if (parts.length > 1) {
      this.sshExtraOpts = parts.slice(1); // -p PORT or other options
    }
    this.socketPath = remoteSocketPath;
  }

  exec(args: string[]): string {
    // Special handling for 'ls' command: fetch from all tmux sockets
    if (args[0] === 'ls') {
      // Check if it's the complex formatting command (from sessions API)
      // If so, use our custom multi-socket handler
      if (args.length > 2 && args[1] === '-F') {
        return this.execListAllSocketsWithFormat(args);
      }
      // Otherwise just list normally
      return this.execListAllSockets(args);
    }

    // Standard execution for other commands (using configured socket)
    const tmuxArgs = ['tmux', '-S', this.socketPath, ...args]
      .map((arg) => `'${arg.replace(/'/g, "'\\''")}'`)
      .join(' ');
    // Pass remote command as a single string argument to ssh
    const remoteCmd = `bash -c "TERM=xterm ${tmuxArgs}"`;
    const cmd = ['ssh', ...this.sshOpts, ...this.sshExtraOpts, this.sshTarget, remoteCmd];
    return execFileSync(cmd[0], cmd.slice(1), { encoding: 'utf-8' }).trim();
  }

  /**
   * Execute list-sessions with custom formatting (for newer tmux versions)
   * Falls back to simple parsing if -F is not supported
   */
  private execListAllSocketsWithFormat(args: string[]): string {
    const formatArg = args[args.length - 1];
    const escapedFormat = formatArg.replace(/'/g, "'\\''");

    // Try with -F first (for newer tmux)
    const bashScript = `
      echo '[DEBUG] Starting format-based search' >&2
      for sock in /tmp/tmux-*/default; do
        if [ -S "$sock" ]; then
          echo '[DEBUG] Trying format for' "$sock" >&2
          tmux -S "$sock" ls -F '${escapedFormat}' 2>/dev/null || true
        fi
      done
    `.trim();

    const escapedScript = bashScript.replace(/'/g, "'\\''");
    const remoteCmd = `bash -c "TERM=xterm bash -c '${escapedScript}'"`;
    const cmd = ['ssh', ...this.sshOpts, ...this.sshExtraOpts, this.sshTarget, remoteCmd];

    console.log(`[SshTmux] Executing format-based list on ${this.hostId}`);

    try {
      const result = execFileSync(cmd[0], cmd.slice(1), { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      console.log(`[SshTmux] Format result (${result.length} chars):`, result);
      // If we got good output, return it
      if (result && !result.includes('unknown option')) {
        return result;
      }
    } catch (error: any) {
      console.warn(`[SshTmux] Format-based list failed, will use simple fallback`);
    }

    // Fall back to simple list parsing if -F doesn't work
    console.log(`[SshTmux] Using simple list parsing fallback`);
    return this.execListAllSocketsSimple();
  }

  /**
   * Execute simple 'tmux ls' and parse the output
   */
  private execListAllSocketsSimple(): string {
    // Try direct tmux ls first - some tmux versions don't support multiple sockets well
    const simpleCmd = `tmux ls`;
    const cmd = ['ssh', ...this.sshOpts, ...this.sshExtraOpts, this.sshTarget, simpleCmd];

    console.log(`[SshTmux] Executing simple tmux ls on ${this.hostId}`);
    console.log(`[SshTmux] Simple cmd:`, cmd);

    try {
      const output = execFileSync(cmd[0], cmd.slice(1), { encoding: 'utf-8' }).trim();
      console.log(`[SshTmux] Simple tmux ls output (${output.length} chars):`, output.substring(0, 300));

      // Parse simple tmux ls output (one session per line like "session-name: N windows ...")
      // Convert to the format expected by the API
      return output
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          // Line format: "session-name: N windows (created ...)"
          const match = line.match(/^([^:]+):\s+(\d+)\s+windows?/);
          if (!match) {
            console.log(`[SshTmux] Line did not match pattern:`, line);
            return '';
          }
          const [, name] = match;
          // Return in __WORKOS__ delimited format
          // name__WORKOS__created__WORKOS__attached__WORKOS__command__WORKOS__directory__WORKOS__role__WORKOS__instructionPath
          const created = Math.floor(Date.now() / 1000).toString(); // Use current time as placeholder
          return `${name}__WORKOS__${created}__WORKOS__0__WORKOS____WORKOS____WORKOS____WORKOS__`;
        })
        .join('\n');
    } catch (error: any) {
      console.error(`[SshTmux] Simple list failed:`, error.message, error.stderr?.toString());
      throw error;
    }
  }

  /**
   * Execute list-sessions across all available tmux sockets on the remote host
   */
  private execListAllSockets(args: string[]): string {
    const formatArg = args[args.length - 1];

    // Properly escape formatArg for bash (single-quote safe)
    const escapedFormat = formatArg.replace(/'/g, "'\\''");

    // Build a bash script that:
    // 1. Finds all tmux sockets
    // 2. Lists sessions from each socket
    // 3. Aggregates results
    const bashScript = `
      echo '[DEBUG] Starting multi-socket search' >&2
      for sock in /tmp/tmux-*/default; do
        echo '[DEBUG] Checking socket:' "$sock" >&2
        if [ -S "$sock" ]; then
          echo '[DEBUG] Found socket:' "$sock" >&2
          tmux -S "$sock" ls -F '${escapedFormat}' 2>&1 || true
        else
          echo '[DEBUG] Not a socket:' "$sock" >&2
        fi
      done
      echo '[DEBUG] Multi-socket search complete' >&2
    `.trim();

    const escapedScript = bashScript.replace(/'/g, "'\\''");
    const remoteCmd = `bash -c "TERM=xterm bash -c '${escapedScript}'"`;
    const cmd = ['ssh', ...this.sshOpts, ...this.sshExtraOpts, this.sshTarget, remoteCmd];

    console.log(`[SshTmux] Executing multi-socket list on ${this.hostId}`);
    console.log(`[SshTmux] SSH target: ${this.sshTarget}`);
    console.log(`[SshTmux] Bash script:`, bashScript.substring(0, 300));
    console.log(`[SshTmux] Remote command:`, remoteCmd.substring(0, 400));
    console.log(`[SshTmux] SSH cmd args:`, cmd);

    try {
      const result = execFileSync(cmd[0], cmd.slice(1), { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      console.log(`[SshTmux] Got result (${result.length} chars):`, result.substring(0, 500));
      return result;
    } catch (error: any) {
      // If multi-socket approach fails, fall back to single socket
      console.error(`[SshTmux] multi-socket list EXCEPTION:`, {
        message: error.message,
        code: error.code,
        signal: error.signal,
        status: error.status,
        stderr: error.stderr?.toString(),
        stdout: error.stdout?.toString(),
      });
      console.warn(`[SshTmux] Falling back to single socket: ${this.socketPath}`);
      const tmuxArgs = ['tmux', '-S', this.socketPath, ...args]
        .map((arg) => `'${arg.replace(/'/g, "'\\''")}'`)
        .join(' ');
      const fallbackCmd = `bash -c "TERM=xterm ${tmuxArgs}"`;
      const fallbackExecCmd = ['ssh', ...this.sshOpts, ...this.sshExtraOpts, this.sshTarget, fallbackCmd];
      try {
        const fallbackResult = execFileSync(fallbackExecCmd[0], fallbackExecCmd.slice(1), { encoding: 'utf-8' }).trim();
        console.log(`[SshTmux] Fallback result (${fallbackResult.length} chars):`, fallbackResult.substring(0, 300));
        return fallbackResult;
      } catch (fallbackError: any) {
        console.error(`[SshTmux] Fallback also failed:`, fallbackError.message);
        throw fallbackError;
      }
    }
  }

  isAvailable(): boolean {
    try {
      execFileSync('ssh', [...this.sshOpts, this.sshTarget, 'tmux', '-V'], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * HTTP-based tmux provider for remote agents (e.g., WSL agent).
 * Communicates via HTTP API instead of SSH.
 */
export class HttpRemoteProvider implements TmuxProvider {
  readonly socketPath = undefined;
  readonly providerType = 'http' as const;
  readonly agentUrl: string; // Made public for server.ts access

  constructor(
    readonly hostId: string,
    readonly displayName: string,
    agentUrl: string // e.g., "http://172.29.214.157:3001"
  ) {
    this.agentUrl = agentUrl;
  }

  /**
   * Make HTTP request to the agent using curl (synchronous)
   */
  private httpRequest(method: string, path: string, body?: any): string {
    const url = this.agentUrl + path;
    const args: string[] = ['-sf'];

    if (method === 'POST') {
      args.push('-X', 'POST');
      args.push('-H', 'Content-Type: application/json');
      if (body) {
        args.push('-d', JSON.stringify(body));
      }
    }

    args.push(url);

    try {
      const result = execFileSync('curl', args, { encoding: 'utf-8', timeout: 5000 });
      return result;
    } catch (error: any) {
      throw new Error(`HTTP request failed: ${error.message}`);
    }
  }

  exec(args: string[]): string {
    // Map tmux commands to HTTP API calls
    if (args[0] === 'ls' && args[1] === '-F') {
      // List sessions
      const response = this.httpRequest('GET', '/api/sessions');
      const parsed = JSON.parse(response);
      return parsed.sessions
        .map((s: any) => {
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
      } else {
        this.httpRequest('POST', `/api/sessions/${sessionName}/send-key`, { key });
      }
      return '';
    }

    // For other commands, we can't map them
    throw new Error(`HttpRemoteProvider does not support tmux ${args[0]} command`);
  }

  isAvailable(): boolean {
    // HTTP providers are available if configured (network checks happen at runtime)
    return true;
  }
}

/**
 * Manages multiple TmuxProvider instances across multiple hosts.
 * Provides composite session IDs in the format "hostId:sessionName".
 */
export class MultiHostSessionPool {
  private providers = new Map<string, TmuxProvider>();

  constructor(providers: TmuxProvider[]) {
    for (const provider of providers) {
      this.providers.set(provider.hostId, provider);
    }
  }

  /**
   * Resolve a composite session ID to its provider and session name.
   * Format: "hostId:sessionName" or just "sessionName" (defaults to "local").
   */
  resolve(compositeId: string): { provider: TmuxProvider; sessionName: string } {
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
  listAll(executor: (provider: TmuxProvider) => string[]): { hostId: string; displayName: string; sessions: string[] }[] {
    const result: { hostId: string; displayName: string; sessions: string[] }[] = [];
    for (const [hostId, provider] of this.providers) {
      try {
        const sessions = executor(provider);
        result.push({
          hostId,
          displayName: provider.displayName,
          sessions,
        });
      } catch (error) {
        console.warn(`[tmux] failed to list sessions on ${hostId}:`, error instanceof Error ? error.message : error);
      }
    }
    return result;
  }

  /**
   * Get a provider by host ID.
   */
  getProvider(hostId: string): TmuxProvider | undefined {
    return this.providers.get(hostId);
  }

  /**
   * Get all providers.
   */
  getAllProviders(): TmuxProvider[] {
    return Array.from(this.providers.values());
  }
}

// ---------------------------------------------------------------------------
// Auto-resolution
// ---------------------------------------------------------------------------

function candidateSocketPaths(): string[] {
  const paths: string[] = [];
  try {
    const uid = execSync('id -u', { encoding: 'utf-8' }).trim();
    paths.push(`/tmp/tmux-${uid}/default`);
  } catch {
    // ignore
  }
  for (const uid of ['1000', '0']) {
    const p = `/tmp/tmux-${uid}/default`;
    if (!paths.includes(p)) paths.push(p);
  }
  return paths;
}

let _resolved: TmuxProvider | null = null;
let _pool: MultiHostSessionPool | null = null;

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
export function resolveTmuxProvider(): TmuxProvider {
  if (_resolved) return _resolved;

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
export function resetTmuxProvider(): void {
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
export function buildSessionPool(): MultiHostSessionPool {
  if (_pool) return _pool;

  let hostsConfig: any[] = [];

  // Try parsing WORK_OS_HOSTS (single JSON array)
  const hostsEnv = process.env.WORK_OS_HOSTS;
  if (hostsEnv) {
    try {
      hostsConfig = JSON.parse(hostsEnv);
    } catch (error) {
      console.warn('[tmux-pool] failed to parse WORK_OS_HOSTS:', error instanceof Error ? error.message : error);
    }
  }

  // Fallback: try individual WORK_OS_HOSTS_* env vars
  if (hostsConfig.length === 0) {
    if (process.env.WORK_OS_HOSTS_HVU) {
      try {
        hostsConfig.push(JSON.parse(process.env.WORK_OS_HOSTS_HVU));
      } catch (e) {
        console.warn('[tmux-pool] failed to parse WORK_OS_HOSTS_HVU');
      }
    }
    if (process.env.WORK_OS_HOSTS_WSL) {
      try {
        hostsConfig.push(JSON.parse(process.env.WORK_OS_HOSTS_WSL));
      } catch (e) {
        console.warn('[tmux-pool] failed to parse WORK_OS_HOSTS_WSL');
      }
    }
  }

  // Build providers from config
  if (hostsConfig.length > 0) {
    const providers: TmuxProvider[] = [];

    for (const config of hostsConfig) {
      console.log(`[tmux-pool] Processing config:`, JSON.stringify(config));
      if (config.type === 'local') {
        if (config.socketPath) {
          providers.push(new ExplicitSocketProvider(config.socketPath));
        } else {
          providers.push(resolveTmuxProvider());
        }
      } else if (config.type === 'ssh') {
        console.log(`[tmux-pool] Creating SshTmuxProvider: hostId=${config.hostId}, sshTarget=${config.sshTarget}`);
        providers.push(
          new SshTmuxProvider(config.hostId, config.displayName, config.sshTarget, config.socketPath)
        );
      } else if (config.type === 'http') {
        console.log(`[tmux-pool] Creating HttpRemoteProvider: hostId=${config.hostId}, agentUrl=${config.agentUrl}`);
        providers.push(
          new HttpRemoteProvider(config.hostId, config.displayName, config.agentUrl)
        );
      }
    }

    if (providers.length > 0) {
      _pool = new MultiHostSessionPool(providers);
      console.log(`[tmux-pool] initialized with ${providers.length} host(s):`, providers.map(p => `${p.hostId}(${p.displayName})`).join(', '));
      return _pool;
    }
  }

  // Fallback: single local provider
  _pool = new MultiHostSessionPool([resolveTmuxProvider()]);
  return _pool;
}

/** Bust the cached pool (useful in tests). */
export function resetSessionPool(): void {
  _pool = null;
}
