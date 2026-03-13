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
}

// ---------------------------------------------------------------------------
// Concrete strategies
// ---------------------------------------------------------------------------

class DefaultSocketProvider implements TmuxProvider {
  readonly socketPath = undefined;

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
