import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { spawn, type ChildProcess } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';

const TEST_PORT = 9278 + 100; // 9378 — 割当表外のテスト用ポート

let serverProc: ChildProcess | null = null;
let client: Client | null = null;

function firstTextBlock(result: unknown, field: 'content' | 'contents' = 'content'): string {
  if (typeof result !== 'object' || result === null) {
    throw new Error(`MCP result must be an object with ${field}`);
  }

  const blocks = (result as Record<string, unknown>)[field];
  if (!Array.isArray(blocks) || blocks.length === 0) {
    throw new Error(`MCP result must contain at least one ${field} block`);
  }

  const first = blocks[0] as unknown;
  if (typeof first !== 'object' || first === null || !('text' in first) || typeof first.text !== 'string') {
    throw new Error(`The first ${field} block must contain text`);
  }

  return first.text;
}

async function waitForHealthz(port: number, timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (res.ok) return;
    } catch { }
    await sleep(500);
  }
  throw new Error(`healthz did not come up on port ${port} within ${timeoutMs}ms`);
}

async function waitForMcp(port: number, timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0.1.0' } } }),
      });
      if (res.ok || res.status === 200) return;
    } catch { }
    await sleep(500);
  }
  throw new Error(`MCP /mcp did not respond within ${timeoutMs}ms`);
}

describe('MCP server e2e', () => {
  beforeAll(async () => {
    serverProc = spawn('npx', ['ts-node', '--project', 'tsconfig.server.json', 'src/server.ts'], {
      cwd: process.cwd(),
      env: { ...process.env, PORT: String(TEST_PORT), NODE_ENV: 'development', TMUX_SOCKET: '/tmp/tmux-1000/default' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    serverProc.stderr?.on('data', (d) => process.stderr.write(`[srv] ${d}`));
    await waitForHealthz(TEST_PORT);
    await waitForMcp(TEST_PORT);

    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${TEST_PORT}/mcp`));
    client = new Client({ name: 'e2e-test', version: '0.1.0' }, { capabilities: {} });
    await client.connect(transport);
  }, 60000);

  afterAll(async () => {
    try { await client?.close(); } catch { }
    serverProc?.kill('SIGTERM');
    await sleep(1000);
    if (serverProc && !serverProc.killed) serverProc.kill('SIGKILL');
  });

  it('healthz returns 200 with name and version', async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/healthz`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.name).toBe('work-os');
    expect(body.version).toBeDefined();
  });

  it('tools/list returns 11 tools with annotations', async () => {
    const result = await client!.listTools();
    const names = result.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'capture_session', 'control_clients', 'create_session', 'get_auto_accept',
      'kill_session', 'list_clients', 'list_sessions', 'list_templates',
      'open_shell', 'send_key', 'set_auto_accept',
    ]);
    for (const tool of result.tools) {
      expect(tool.annotations).toBeDefined();
    }
  });

  it('list_templates returns templates array', async () => {
    const result = await client!.callTool({ name: 'list_templates', arguments: {} });
    const text = firstTextBlock(result);
    const parsed = JSON.parse(text);
    expect(parsed).toHaveProperty('templates');
    expect(Array.isArray(parsed.templates)).toBe(true);
  });

  it('list_sessions returns sessions array', async () => {
    const result = await client!.callTool({ name: 'list_sessions', arguments: {} });
    const text = firstTextBlock(result);
    const parsed = JSON.parse(text);
    expect(parsed).toHaveProperty('sessions');
    expect(Array.isArray(parsed.sessions)).toBe(true);
  });

  it('kill_session dry-run returns dryRun flag without killing', async () => {
    const result = await client!.callTool({ name: 'kill_session', arguments: { id: 'local:nonexistent-test', confirm: false } });
    const text = firstTextBlock(result);
    const parsed = JSON.parse(text);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.id).toBe('local:nonexistent-test');
  });

  it('send_key dry-run returns preview without sending', async () => {
    const result = await client!.callTool({ name: 'send_key', arguments: { id: 'local:nonexistent-test', key: 'y', confirm: false } });
    const text = firstTextBlock(result);
    const parsed = JSON.parse(text);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.key).toBe('y');
  });

  it('resources are readable (workos://spec and workos://guide)', async () => {
    const specResult = await client!.readResource({ uri: 'workos://spec' });
    const specText = firstTextBlock(specResult, 'contents');
    const spec = JSON.parse(specText);
    expect(spec.namespace).toBe('workos');
    expect(spec.capabilities).toBeDefined();
    expect(Array.isArray(spec.capabilities)).toBe(true);
    expect(spec.capabilities!.length).toBe(11);

    const guideResult = await client!.readResource({ uri: 'workos://guide' });
    const guideText = firstTextBlock(guideResult, 'contents');
    expect(guideText).toContain('# Work OS MCP Guide');
    expect(guideText).toContain('namespace');
  });
});
