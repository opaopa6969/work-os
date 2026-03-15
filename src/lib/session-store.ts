/**
 * Session metadata store for managing commander/target session relationships.
 * This runs on the server and maintains the state of linked sessions.
 */

export interface SessionMetadata {
  role?: 'commander' | 'target' | 'regular';
  linkedSessionId?: string; // For commander: the target session; for target: the commander session
}

export class SessionStore {
  private metadata = new Map<string, SessionMetadata>();

  /**
   * Get metadata for a session
   */
  getMetadata(sessionId: string): SessionMetadata {
    return this.metadata.get(sessionId) || {};
  }

  /**
   * Set metadata for a session
   */
  setMetadata(sessionId: string, metadata: SessionMetadata): void {
    this.metadata.set(sessionId, { ...this.getMetadata(sessionId), ...metadata });
  }

  /**
   * Link a commander session to a target session
   */
  linkCommander(commanderSessionId: string, targetSessionId: string): void {
    this.setMetadata(commanderSessionId, {
      role: 'commander',
      linkedSessionId: targetSessionId,
    });
    this.setMetadata(targetSessionId, {
      role: 'target',
      linkedSessionId: commanderSessionId,
    });
  }

  /**
   * Unlink a commander from its target
   */
  unlinkCommander(commanderSessionId: string): void {
    const metadata = this.getMetadata(commanderSessionId);
    if (metadata.linkedSessionId) {
      this.metadata.delete(metadata.linkedSessionId);
    }
    this.metadata.delete(commanderSessionId);
  }

  /**
   * Get all commander/target pairs
   */
  getAllLinks(): Array<{ commander: string; target: string }> {
    const links: Array<{ commander: string; target: string }> = [];
    for (const [sessionId, meta] of this.metadata.entries()) {
      if (meta.role === 'commander' && meta.linkedSessionId) {
        links.push({ commander: sessionId, target: meta.linkedSessionId });
      }
    }
    return links;
  }
}

// Global singleton instance
export const sessionStore = new SessionStore();
