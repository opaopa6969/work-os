import { describe, it, expect, beforeEach } from 'vitest'
import { SessionStore } from './session-store'

describe('SessionStore', () => {
  let store: SessionStore

  beforeEach(() => {
    store = new SessionStore()
  })

  describe('getMetadata', () => {
    it('returns {} for unknown session', () => {
      expect(store.getMetadata('unknown-session')).toEqual({})
    })
  })

  describe('setMetadata', () => {
    it('stores and retrieves metadata', () => {
      store.setMetadata('session-1', { role: 'regular' })
      expect(store.getMetadata('session-1')).toEqual({ role: 'regular' })
    })

    it('merges without overwriting entire object', () => {
      store.setMetadata('session-1', { role: 'commander', linkedSessionId: 'target-1' })
      store.setMetadata('session-1', { role: 'regular' })
      expect(store.getMetadata('session-1')).toEqual({
        role: 'regular',
        linkedSessionId: 'target-1',
      })
    })
  })

  describe('linkCommander', () => {
    it('sets commander role with linkedSessionId on the commander side', () => {
      store.linkCommander('cmd-1', 'tgt-1')
      expect(store.getMetadata('cmd-1')).toEqual({
        role: 'commander',
        linkedSessionId: 'tgt-1',
      })
    })

    it('sets target role with linkedSessionId (bidirectional)', () => {
      store.linkCommander('cmd-1', 'tgt-1')
      expect(store.getMetadata('tgt-1')).toEqual({
        role: 'target',
        linkedSessionId: 'cmd-1',
      })
    })
  })

  describe('unlinkCommander', () => {
    it('removes both commander and target entries', () => {
      store.linkCommander('cmd-1', 'tgt-1')
      store.unlinkCommander('cmd-1')
      expect(store.getMetadata('cmd-1')).toEqual({})
      expect(store.getMetadata('tgt-1')).toEqual({})
    })

    it('is a no-op for unknown sessionId', () => {
      // Should not throw
      expect(() => store.unlinkCommander('no-such-session')).not.toThrow()
    })
  })

  describe('getAllLinks', () => {
    it('returns empty array initially', () => {
      expect(store.getAllLinks()).toEqual([])
    })

    it('returns commander-target pairs after linkCommander', () => {
      store.linkCommander('cmd-1', 'tgt-1')
      expect(store.getAllLinks()).toEqual([{ commander: 'cmd-1', target: 'tgt-1' }])
    })

    it('does NOT include target sessions (only commanders)', () => {
      store.linkCommander('cmd-1', 'tgt-1')
      const links = store.getAllLinks()
      const hasTarget = links.some((l) => l.commander === 'tgt-1')
      expect(hasTarget).toBe(false)
    })

    it('returns multiple pairs when multiple links exist', () => {
      store.linkCommander('cmd-1', 'tgt-1')
      store.linkCommander('cmd-2', 'tgt-2')
      const links = store.getAllLinks()
      expect(links).toHaveLength(2)
      expect(links).toContainEqual({ commander: 'cmd-1', target: 'tgt-1' })
      expect(links).toContainEqual({ commander: 'cmd-2', target: 'tgt-2' })
    })
  })
})
