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
}

// ---------------------------------------------------------------------------
// Concrete strategies
// ---------------------------------------------------------------------------

class DefaultSocketProvider implements TmuxProvider {
  readonly socketPath = undefined;
  readonly hostId = 'local';
  readonly displayName = 'Local';

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

  constructor(
    readonly hostId: string,
    readonly displayName: string,
    sshTarget: string, // "opa@172.x.x.x"
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
    this.sshTarget = sshTarget;
    this.socketPath = remoteSocketPath;
  }

  exec(args: string[]): string {
    // Build tmux command with proper escaping for bash -c
    const tmuxArgs = ['tmux', '-S', this.socketPath, ...args]
      .map((arg) => `'${arg.replace(/'/g, "'\\''")}'`)
      .join(' ');
    // Pass remote command as a single string argument to ssh
    const remoteCmd = `bash -c "TERM=xterm ${tmuxArgs}"`;
    const cmd = ['ssh', ...this.sshOpts, this.sshTarget, remoteCmd];
    return execFileSync(cmd[0], cmd.slice(1), { encoding: 'utf-8' }).trim();
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

  const hostsEnv = process.env.WORK_OS_HOSTS;
  if (hostsEnv) {
    try {
      const hostsConfig = JSON.parse(hostsEnv);
      const providers: TmuxProvider[] = [];

      for (const config of hostsConfig) {
        if (config.type === 'local') {
          if (config.socketPath) {
            providers.push(new ExplicitSocketProvider(config.socketPath));
          } else {
            providers.push(resolveTmuxProvider());
          }
        } else if (config.type === 'ssh') {
          providers.push(
            new SshTmuxProvider(config.hostId, config.displayName, config.sshTarget, config.socketPath)
          );
        }
      }

      if (providers.length > 0) {
        _pool = new MultiHostSessionPool(providers);
        console.log(`[tmux-pool] initialized with ${providers.length} host(s)`);
        return _pool;
      }
    } catch (error) {
      console.warn('[tmux-pool] failed to parse WORK_OS_HOSTS:', error instanceof Error ? error.message : error);
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
