import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { AutoAcceptManager } from './auto-accept'
import type { MultiHostSessionPool } from './tmux-provider'

// Minimal stub for MultiHostSessionPool — only needs to satisfy the type
function makePool(): MultiHostSessionPool {
  return {
    resolve: vi.fn().mockReturnValue({ provider: {}, sessionName: 'stub' }),
  } as unknown as MultiHostSessionPool
}

describe('AutoAcceptManager', () => {
  let manager: AutoAcceptManager

  beforeEach(() => {
    vi.useFakeTimers()
    manager = new AutoAcceptManager()
  })

  afterEach(() => {
    // Clean up any lingering timers
    manager.getActive().forEach((id) => manager.stop(id))
    vi.useRealTimers()
  })

  describe('isActive', () => {
    it('returns false initially for any session', () => {
      expect(manager.isActive('cmd-1')).toBe(false)
    })
  })

  describe('start + isActive', () => {
    it('returns true after starting', () => {
      manager.start('cmd-1', 'tgt-1', makePool())
      expect(manager.isActive('cmd-1')).toBe(true)
    })
  })

  describe('stop', () => {
    it('returns false after stopping', () => {
      manager.start('cmd-1', 'tgt-1', makePool())
      manager.stop('cmd-1')
      expect(manager.isActive('cmd-1')).toBe(false)
    })
  })

  describe('getActive', () => {
    it('returns empty array initially', () => {
      expect(manager.getActive()).toEqual([])
    })

    it('returns started session IDs', () => {
      manager.start('cmd-1', 'tgt-1', makePool())
      manager.start('cmd-2', 'tgt-2', makePool())
      const active = manager.getActive()
      expect(active).toContain('cmd-1')
      expect(active).toContain('cmd-2')
      expect(active).toHaveLength(2)
    })
  })

  describe('start twice (idempotent)', () => {
    it('only one timer after starting the same session twice', () => {
      manager.start('cmd-1', 'tgt-1', makePool())
      manager.start('cmd-1', 'tgt-1', makePool())
      // getActive should still have cmd-1 exactly once
      const active = manager.getActive()
      expect(active.filter((id) => id === 'cmd-1')).toHaveLength(1)
    })
  })
})

// ---------------------------------------------------------------------------
// Test the private prompt-detection logic via a subclass that exposes it
// ---------------------------------------------------------------------------

class TestableAutoAcceptManager extends AutoAcceptManager {
  public testIsWaitingForInput(content: string): boolean {
    // Access the private method via bracket notation (TypeScript allows this in tests)
    return (this as any).isWaitingForInput(content)
  }

  public testSelectKey(content: string): string {
    return (this as any).selectKey(content)
  }
}

describe('AutoAcceptManager prompt detection (private logic via subclass)', () => {
  let manager: TestableAutoAcceptManager

  beforeEach(() => {
    manager = new TestableAutoAcceptManager()
  })

  describe('isWaitingForInput', () => {
    it('returns false for empty content', () => {
      expect(manager.testIsWaitingForInput('')).toBe(false)
    })

    it('detects y/n prompt', () => {
      expect(manager.testIsWaitingForInput('Do you want to continue? (y/n)')).toBe(true)
    })

    it('detects Y/N prompt (uppercase)', () => {
      expect(manager.testIsWaitingForInput('Overwrite file? [Y/N]')).toBe(true)
    })

    it('detects numbered selection prompts', () => {
      const content = 'Choose an option:\n1. Allow\n2. Deny'
      expect(manager.testIsWaitingForInput(content)).toBe(true)
    })

    it('detects bullet-style numbered prompts', () => {
      const content = '● 1. Allow for this session'
      expect(manager.testIsWaitingForInput(content)).toBe(true)
    })

    it('detects trailing question mark', () => {
      expect(manager.testIsWaitingForInput('Are you sure?')).toBe(true)
    })

    it('detects shell prompt (bare $ or # line)', () => {
      // The regex /^\s*[$#>]\s*$/ matches a line that is only whitespace + prompt char
      expect(manager.testIsWaitingForInput('some output\n$ ')).toBe(true)
    })

    it('returns false for plain output with no prompt signals', () => {
      const content = 'Some output line\nAnother line\nDone.'
      expect(manager.testIsWaitingForInput(content)).toBe(false)
    })
  })

  describe('selectKey', () => {
    it('returns "1\\n" for numbered allow prompt', () => {
      expect(manager.testSelectKey('1. Allow for this session')).toBe('1\n')
    })

    it('returns "1\\n" for bullet allow prompt', () => {
      expect(manager.testSelectKey('● 1. Allow')).toBe('1\n')
    })

    it('returns "y\\n" for a yes/no prompt', () => {
      expect(manager.testSelectKey('Do you want to continue? (y/n)')).toBe('y\n')
    })

    it('returns "y\\n" as default', () => {
      expect(manager.testSelectKey('Some unrecognised prompt')).toBe('y\n')
    })
  })
})
