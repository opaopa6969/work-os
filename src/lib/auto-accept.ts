import type { MultiHostSessionPool } from './tmux-provider';

/**
 * AutoAcceptManager monitors target sessions for (y/n) or numbered selection prompts
 * and automatically responds with the appropriate key.
 */
export class AutoAcceptManager {
  private timers = new Map<string, NodeJS.Timeout>();

  /**
   * Start auto-accept polling for a commander session monitoring its target
   */
  start(commanderSessionId: string, targetSessionId: string, pool: MultiHostSessionPool): void {
    if (this.timers.has(commanderSessionId)) {
      this.stop(commanderSessionId);
    }

    const timer = setInterval(() => {
      this.pollAndRespond(commanderSessionId, targetSessionId, pool);
    }, 5000);

    this.timers.set(commanderSessionId, timer);
    console.log(`[auto-accept] Started monitoring ${commanderSessionId} → ${targetSessionId}`);
  }

  /**
   * Stop auto-accept polling for a commander session
   */
  stop(commanderSessionId: string): void {
    const timer = this.timers.get(commanderSessionId);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(commanderSessionId);
      console.log(`[auto-accept] Stopped monitoring ${commanderSessionId}`);
    }
  }

  /**
   * Check if auto-accept is active for a session
   */
  isActive(commanderSessionId: string): boolean {
    return this.timers.has(commanderSessionId);
  }

  /**
   * Get all active auto-accept sessions
   */
  getActive(): string[] {
    return Array.from(this.timers.keys());
  }

  private pollAndRespond(commanderSessionId: string, targetSessionId: string, pool: MultiHostSessionPool): void {
    try {
      const { provider, sessionName } = pool.resolve(targetSessionId);

      // Capture the current session content
      const content = this.captureSession(provider, sessionName);
      if (!content) {
        return;
      }

      // Check if waiting for input
      if (!this.isWaitingForInput(content)) {
        return;
      }

      // Determine which key to send
      const key = this.selectKey(content);

      // Send the key
      this.sendKey(provider, sessionName, key);
      console.log(`[auto-accept] Detected prompt in ${targetSessionId}, sending: ${key}`);
    } catch (error) {
      // Silently ignore errors during polling (target may be disconnected, etc.)
    }
  }

  private captureSession(provider: any, sessionName: string): string {
    try {
      // Try capture-pane with -a flag (all history)
      try {
        const alt = provider.exec(['capture-pane', '-a', '-e', '-J', '-p', '-t', sessionName]);
        if (alt) return alt;
      } catch {}

      // Fall back to visible pane only
      return provider.exec(['capture-pane', '-e', '-J', '-p', '-t', sessionName]);
    } catch {
      return '';
    }
  }

  private isWaitingForInput(content: string): boolean {
    if (!content) return false;

    const lines = content.split('\n');
    const lastLine = lines[lines.length - 1] || '';
    const lastTwoLines = lines.slice(-2).join('\n');

    // Look for common prompts:
    // - "(y/n)" or "[y/n]" etc.
    // - Numbered selections: "1. Allow", "2. Deny", etc.
    // - Question marks at end
    // - Cursors ready for input (no trailing newline or specific patterns)

    return (
      /[Yy]\/[Nn]/.test(lastTwoLines) ||
      /\d+\.\s+[A-Za-z]/.test(lastTwoLines) ||
      /●\s*\d+\./.test(lastTwoLines) ||
      /\?$/.test(lastLine.trim()) ||
      /^\s*[$#>]\s*$/.test(lastLine) // Shell prompt
    );
  }

  private selectKey(content: string): string {
    // Check for numbered selection (Claude Code style)
    // Pattern: "1. Allow", "2. Deny", etc.
    if (/1\.\s+allow|1\.\s+yes|●\s*1\./i.test(content)) {
      return '1\n';
    }

    // Default to 'y' for yes/no prompts
    return 'y\n';
  }

  private sendKey(provider: any, sessionName: string, key: string): void {
    // Split the key string and send each character
    for (const char of key) {
      if (char === '\n') {
        provider.exec(['send-keys', '-t', sessionName, 'Enter']);
      } else {
        provider.exec(['send-keys', '-l', '-t', sessionName, char]);
      }
    }
  }
}

// Global singleton instance
export const autoAcceptManager = new AutoAcceptManager();
