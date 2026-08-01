import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { spawn, ChildProcess, execFileSync } from 'child_process'
import { createServer } from 'net'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { io as ioClient, Socket } from 'socket.io-client'

const AGENT_SRC = join(__dirname, 'index.ts')
const TSCONFIG = join(__dirname, '..', 'tsconfig.agent.json')

function spawnAgent(port: number, tmuxSocket: string): ChildProcess {
  const env: Record<string, string> = {
    PATH: process.env.PATH || '',
    HOME: process.env.HOME || '',
    AGENT_PORT: String(port),
    TMUX_SOCKET: tmuxSocket,
    TS_NODE_PROJECT: TSCONFIG,
    NODE_ENV: 'test',
  }
  return spawn('node', [
    '--require',
    require.resolve('ts-node/register'),
    AGENT_SRC,
  ], { env, stdio: ['ignore', 'pipe', 'pipe'] })
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = createServer()
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      if (addr && typeof addr === 'object') {
        const p = addr.port
        srv.close(() => resolve(p))
      } else {
        srv.close(() => resolve(0))
      }
    })
  })
}

function waitForAgent(proc: ChildProcess, timeoutMs = 20000): Promise<void> {
  return new Promise((resolve, reject) => {
    let buf = ''
    const timer = setTimeout(() => {
      reject(new Error(`agent did not print ready banner; stdout so far: ${buf}`))
    }, timeoutMs)
    const onData = (chunk: Buffer) => {
      buf += chunk.toString()
      if (buf.includes('Ready on http')) {
        clearTimeout(timer)
        proc.stdout?.off('data', onData)
        resolve()
      }
    }
    proc.stdout?.on('data', onData)
    proc.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`agent exited early code=${code}; stderr: ${buf}`))
    })
  })
}

function tmux(socket: string, args: string[]) {
  return execFileSync('tmux', ['-S', socket, ...args], { encoding: 'utf-8' })
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

describe('agent multi-attach (issue #8)', () => {
  let tmpDir: string
  let tmuxSocket: string
  let agentPort: number
  let agent: ChildProcess
  let sessionName: string

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'wos-agent-test-'))
    tmuxSocket = join(tmpDir, 'default')
    agentPort = await freePort()
    agent = spawnAgent(agentPort, tmuxSocket)
    agent.stdout?.on('data', (d) => process.stderr.write(`[agent] ${d}`))
    agent.stderr?.on('data', (d) => process.stderr.write(`[agent!] ${d}`))
    agent.on('exit', (code, sig) => process.stderr.write(`[agent exit] code=${code} sig=${sig}\n`))
    await waitForAgent(agent, 20000)
    process.stderr.write(`[test] agent up on ${agentPort}\n`)
  })

  afterAll(async () => {
    if (agent && !agent.killed) {
      agent.kill('SIGTERM')
      await sleep(200)
      if (!agent.killed) agent.kill('SIGKILL')
    }
    try {
      tmux(tmuxSocket, ['kill-server'])
    } catch {
      // ignore
    }
    rmSync(tmpDir, { recursive: true, force: true })
  })

  beforeEach(() => {
    sessionName = `wos-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    tmux(tmuxSocket, ['new-session', '-d', '-s', sessionName, '-x', '120', '-y', '32'])
  })

  afterEach(() => {
    try {
      tmux(tmuxSocket, ['kill-session', '-t', sessionName])
    } catch {
      // already gone
    }
  })

  function connect(): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const sock = ioClient(`http://127.0.0.1:${agentPort}`, { path: '/socket.io' })
      sock.on('connect', () => resolve(sock))
      sock.on('connect_error', reject)
    })
  }

  function start(sock: Socket, sessionId: string, cols = 80, rows = 24): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false
      const onStatus = (p: unknown) => {
        if (settled) return
        if (typeof p === 'object' && p !== null && (p as { state?: string }).state === 'ready') {
          settled = true
          sock.off('terminal:status', onStatus)
          sock.off('terminal:error', onErr)
          resolve()
        }
      }
      const onErr = (p: unknown) => {
        if (settled) return
        settled = true
        sock.off('terminal:status', onStatus)
        sock.off('terminal:error', onErr)
        reject(new Error(`terminal:error: ${JSON.stringify(p)}`))
      }
      sock.on('terminal:status', onStatus)
      sock.on('terminal:error', onErr)
      sock.emit('start', { sessionId, cols, rows })
    })
  }

  it('delivers output to both browsers attached to the same session', async () => {
    const s1 = await connect()
    const s2 = await connect()
    try {
      await start(s1, sessionName)
      await start(s2, sessionName)

      const seen1: string[] = []
      const seen2: string[] = []
      s1.on('output', (d: string) => seen1.push(d))
      s2.on('output', (d: string) => seen2.push(d))

      // type into the session via the first client; PTY should echo to both
      s1.emit('command', { data: 'echo hello-wos\r' })
      await sleep(1500)

      const got1 = seen1.join('')
      const got2 = seen2.join('')
      expect(got1).toContain('hello-wos')
      expect(got2).toContain('hello-wos')
    } finally {
      s1.disconnect()
      s2.disconnect()
    }
  })

  it('keeps PTY alive when the first client disconnects and second stays', async () => {
    const s1 = await connect()
    const s2 = await connect()
    try {
      await start(s1, sessionName)
      await start(s2, sessionName)

      s1.disconnect()
      await sleep(500)

      const seen2: string[] = []
      s2.on('output', (d: string) => seen2.push(d))

      // second client still drives the shared PTY
      s2.emit('command', { data: 'echo still-alive\r' })
      await sleep(1500)

      expect(seen2.join('')).toContain('still-alive')

      // healthz should still report 1 bridge
      const res = await fetch(`http://127.0.0.1:${agentPort}/healthz`)
      const body = (await res.json()) as { ptyBridges: number }
      expect(body.ptyBridges).toBe(1)
    } finally {
      s2.disconnect()
    }
  })

  it('releases the PTY when all clients disconnect', async () => {
    const s1 = await connect()
    const s2 = await connect()
    await start(s1, sessionName)
    await start(s2, sessionName)
    s1.disconnect()
    s2.disconnect()
    await sleep(800)

    const res = await fetch(`http://127.0.0.1:${agentPort}/healthz`)
    const body = (await res.json()) as { ptyBridges: number }
    expect(body.ptyBridges).toBe(0)
  })
})
