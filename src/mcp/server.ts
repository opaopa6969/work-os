import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Express } from 'express';
import { z } from 'zod';
import { buildSessionPool, type MultiHostSessionPool } from '../lib/tmux-provider';
import { sessionStore } from '../lib/session-store';
import { autoAcceptManager } from '../lib/auto-accept';
import fs from 'fs-extra';
import path from 'path';

const NAMESPACE = 'workos';
const VERSION = '0.1.21';
const USER_TEMPLATES_DIR = path.join(process.cwd(), 'templates/user');
const DEFAULT_TEMPLATES_DIR = path.join(process.cwd(), 'templates/defaults');

function getPool(): MultiHostSessionPool {
  return buildSessionPool();
}

function resolveTemplateDir(templateName?: string): string | null {
  if (!templateName) return null;
  const userPath = path.join(USER_TEMPLATES_DIR, templateName);
  if (fs.existsSync(userPath)) return userPath;
  const match = templateName.match(/^(.*)-([a-z]{2})$/i);
  if (match) {
    const [, baseName, lang] = match;
    const defaultPath = path.join(DEFAULT_TEMPLATES_DIR, lang, baseName);
    if (fs.existsSync(defaultPath)) return defaultPath;
  }
  return null;
}

function sanitizeSessionName(input: string): string {
  return input.trim().replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 120);
}

function buildSpec(server: McpServer): object {
  return {
    namespace: NAMESPACE,
    name: 'Work OS MCP',
    version: VERSION,
    summary: 'ブラウザベースの tmux 操作ダッシュボード。セッション一覧・キャプチャ・キー送信・auto-accept 制御を MCP tool として提供。',
    capabilities: [
      { kind: 'tool', name: 'list_sessions', summary: '全ホストの tmux セッション一覧', side_effect: 'read', long_running: false, dry_run: false, min_role: 'VIEWER' },
      { kind: 'tool', name: 'create_session', summary: '新規 tmux セッション起動', side_effect: 'write', long_running: false, dry_run: false, min_role: 'MEMBER' },
      { kind: 'tool', name: 'capture_session', summary: '画面キャプチャ + 入力待ち判定', side_effect: 'read', long_running: false, dry_run: false, min_role: 'VIEWER' },
      { kind: 'tool', name: 'send_key', summary: 'tmux セッションにキー送信', side_effect: 'write', long_running: false, dry_run: true, min_role: 'MEMBER' },
      { kind: 'tool', name: 'kill_session', summary: 'tmux セッション終了', side_effect: 'destructive', long_running: false, dry_run: true, min_role: 'MEMBER' },
      { kind: 'tool', name: 'open_shell', summary: '同 CWD で子 bash セッション派生', side_effect: 'write', long_running: false, dry_run: false, min_role: 'MEMBER' },
      { kind: 'tool', name: 'list_clients', summary: 'セッションの tmux クライアント一覧', side_effect: 'read', long_running: false, dry_run: false, min_role: 'VIEWER' },
      { kind: 'tool', name: 'control_clients', summary: 'クライアント detach/kill', side_effect: 'destructive', long_running: false, dry_run: true, min_role: 'MEMBER' },
      { kind: 'tool', name: 'set_auto_accept', summary: 'Commander auto-accept 有効/無効', side_effect: 'write', long_running: false, dry_run: false, min_role: 'MEMBER' },
      { kind: 'tool', name: 'get_auto_accept', summary: 'auto-accept 状態取得', side_effect: 'read', long_running: false, dry_run: false, min_role: 'VIEWER' },
      { kind: 'tool', name: 'list_templates', summary: 'エージェントテンプレート一覧', side_effect: 'read', long_running: false, dry_run: false, min_role: 'VIEWER' },
    ],
    compositions: [
      { title: '自動応答パイプライン', flow: ['workos__capture_session', 'workos__send_key', 'index__agent_send'], note: '入力待ち検知→自動応答→結果中継' },
      { title: '無人エージェント運用', flow: ['workos__list_sessions', 'workos__create_session', 'workos__set_auto_accept', 'volta__svc_health'], note: 'Commander + auto-accept で無人運用' },
      { title: 'マルチエージェント連携', flow: ['workos__capture_session', 'index__agent_fork', 'workos__send_key'], note: 'キャプチャ解析→作業エージェント起動→結果投入' },
    ],
    depends_on: [
      { namespace: 'index', capability: 'index__agent_fork' },
      { namespace: 'index', capability: 'index__agent_send' },
    ],
    health: '/healthz',
    docs: ['workos://guide', 'volta://docs/GUIDE-add-backend'],
  };
}

function buildGuide(): string {
  return `# Work OS MCP Guide

## namespace
\`workos\` — tmux セッション内部の観察・操作に特化。

## tools
- \`list_sessions\`: 全ホストのセッション一覧（read）
- \`create_session\`: 新規セッション起動（write）
- \`capture_session\`: 画面キャプチャ + 入力待ち判定（read）
- \`send_key\`: キー送信（write, confirm オプション）
- \`kill_session\`: セッション終了（destructive, confirm 必須）
- \`open_shell\`: 同 CWD で子 bash 派生（write）
- \`list_clients\`: クライアント一覧（read）
- \`control_clients\`: detach/detach-all/kill（destructive のみ confirm 必須）
- \`set_auto_accept\`: Commander auto-accept 制御（write）
- \`get_auto_accept\`: auto-accept 状態（read）
- \`list_templates\`: テンプレート一覧（read）

## 安全上の注意
- \`kill_session\` と \`control_clients(action=kill)\` は confirm が必須。
- \`send_key\` は confirm オプション。破壊的だが高頻度のため呼び出し側が判断。
- 認証なし API のため、破壊系は全て dry-run 既定。

## 組み合わせ
1. \`capture_session\` → \`isWaitingForInput\` → \`send_key\` で自動応答
2. \`create_session\` + \`set_auto_accept\` で無人運用
3. \`capture_session\` → \`index__agent_fork\` → \`send_key\` でマルチエージェント連携
`;
}

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'workos',
    version: VERSION,
  });

  server.registerTool(
    'list_sessions',
    {
      description: '全ホストの tmux セッション一覧を取得する。危険度: read。前提: なし。',
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true },
    },
    async () => {
      const pool = getPool();
      const allSessions: any[] = [];
      for (const provider of pool.getAllProviders()) {
        try {
          const output = provider.exec(['ls', '-F', '#{session_name}__WORKOS__#{session_created}__WORKOS__#{session_attached}__WORKOS__#{@workos_command}__WORKOS__#{@workos_directory}__WORKOS__#{@workos_role}__WORKOS__#{@workos_instruction_path}']);
          const lines = output.trim().split('\n').filter(Boolean);
          for (const line of lines) {
            const [name, created, attached, command, directory, role, instructionPath] = line.split('__WORKOS__');
            const currentCommand = provider.exec(['display-message', '-p', '-t', name, '#{pane_current_command}']);
            const currentPath = provider.exec(['display-message', '-p', '-t', name, '#{pane_current_path}']);
            const compositeId = `${provider.hostId}:${name}`;
            const metadata = sessionStore.getMetadata(compositeId);
            allSessions.push({
              id: compositeId, name, hostId: provider.hostId, hostName: provider.displayName,
              created: Number(created), isAttached: attached === '1',
              command: command || '', directory: directory || '',
              currentCommand, currentPath,
              sessionRole: metadata.role, linkedSessionId: metadata.linkedSessionId,
            });
          }
        } catch { }
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify({ sessions: allSessions }) }] };
    }
  );

  server.registerTool(
    'create_session',
    {
      description: '新規 tmux セッションを起動する。危険度: write。前提: name, command, cwd が必須。',
      inputSchema: z.object({
        name: z.string().describe('セッション名'),
        command: z.string().describe('起動コマンド'),
        cwd: z.string().describe('作業ディレクトリ'),
        templateName: z.string().optional().describe('テンプレート名（省略可）'),
        hostId: z.string().optional().describe('ホスト ID（省略時 local）'),
        sessionRole: z.string().optional().describe('commander|target（省略可）'),
        linkedSessionId: z.string().optional().describe('リンク先セッション ID（省略可）'),
      }).strict(),
      annotations: {},
    },
    async (args: any) => {
      const pool = getPool();
      const { name, command, cwd, templateName, hostId = 'local', linkedSessionId, sessionRole } = args;
      const sessionName = sanitizeSessionName(String(name));
      const provider = pool.getProvider(String(hostId));
      if (!provider) throw new Error(`host not found: ${hostId}`);
      await fs.ensureDir(cwd);
      const templateDir = resolveTemplateDir(templateName);
      const cmdTokens = String(command).split(/\s+/);
      provider.exec(['new-session', '-d', '-s', sessionName, '-c', String(cwd), ...cmdTokens]);
      provider.exec(['set-option', '-t', sessionName, '@workos_command', String(command)]);
      provider.exec(['set-option', '-t', sessionName, '@workos_directory', String(cwd)]);
      const compositeId = `${provider.hostId}:${sessionName}`;
      if (sessionRole && linkedSessionId) {
        if (sessionRole === 'commander') sessionStore.linkCommander(compositeId, linkedSessionId);
        else if (sessionRole === 'target') sessionStore.setMetadata(compositeId, { role: 'target', linkedSessionId });
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify({ compositeId, sessionName, hostId: provider.hostId, cwd, command }) }] };
    }
  );

  server.registerTool(
    'capture_session',
    {
      description: 'セッションの画面キャプチャと入力待ち判定を取得する。危険度: read。前提: id は compositeId（hostId:sessionName）。',
      inputSchema: z.object({
        id: z.string().describe('compositeId（hostId:sessionName）'),
      }).strict(),
      annotations: { readOnlyHint: true },
    },
    async (args: any) => {
      const pool = getPool();
      const { provider, sessionName } = pool.resolve(args.id);
      let output = '';
      try { output = provider.exec(['capture-pane', '-a', '-e', '-J', '-p', '-t', sessionName]); }
      catch { output = provider.exec(['capture-pane', '-e', '-J', '-p', '-t', sessionName]); }
      const lines = output.trim().split('\n');
      const lastLines = lines.slice(-5).join(' ').toLowerCase();
      const isWaitingForInput = /([\[\(][y\/n]+[\)\]]|\? |proceed\?|continue\?|ready\?)/i.test(lastLines) || /(● \d\. |[1-9]\. allow|[1-9]\. yes|[1-9]\. proceed)/i.test(lastLines);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ id: args.id, content: output, isWaitingForInput, lastLine: lines[lines.length - 1] || '', updatedAt: Date.now() }) }] };
    }
  );

  server.registerTool(
    'send_key',
    {
      description: 'tmux セッションにキーを送信する。危険度: write。confirm=false（既定）なら送信せずプレビューを返す。',
      inputSchema: z.object({
        id: z.string().describe('compositeId'),
        key: z.string().describe('送信するキー（Enter, y, n, C-c 等）'),
        confirm: z.boolean().optional().describe('true で実行。未指定(=false)なら dry-run'),
      }).strict(),
      annotations: {},
    },
    async (args: any) => {
      if (!args.confirm) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ dryRun: true, id: args.id, key: args.key, message: 'confirm: true で送信します' }) }] };
      }
      const pool = getPool();
      const { provider, sessionName } = pool.resolve(args.id);
      provider.exec(['send-keys', '-t', sessionName, args.key]);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ message: `Sent key: ${args.key} to session: ${args.id}` }) }] };
    }
  );

  server.registerTool(
    'kill_session',
    {
      description: 'tmux セッションを終了する。危険度: destructive。confirm=false（既定）なら対象確認のみ。',
      inputSchema: z.object({
        id: z.string().describe('compositeId'),
        confirm: z.boolean().optional().describe('true で実行。未指定(=false)なら dry-run'),
      }).strict(),
      annotations: { destructiveHint: true },
    },
    async (args: any) => {
      if (!args.confirm) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ dryRun: true, id: args.id, action: 'kill-session', message: 'confirm: true で実行します' }) }] };
      }
      const pool = getPool();
      const { provider, sessionName } = pool.resolve(args.id);
      provider.exec(['kill-session', '-t', sessionName]);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ message: `Session ${args.id} killed` }) }] };
    }
  );

  server.registerTool(
    'open_shell',
    {
      description: '同じ CWD で子 bash セッションを派生起動する。危険度: write。前提: id が必須。',
      inputSchema: z.object({
        id: z.string().describe('compositeId'),
      }).strict(),
      annotations: {},
    },
    async (args: any) => {
      const pool = getPool();
      const { provider, sessionName } = pool.resolve(args.id);
      const cwd = provider.exec(['display-message', '-p', '-t', sessionName, '#{pane_current_path}']);
      const newSessionName = `sh-${sessionName}-${Date.now().toString().slice(-4)}`;
      provider.exec(['new-session', '-d', '-s', newSessionName, '-c', cwd, 'bash']);
      const compositeId = `${provider.hostId}:${newSessionName}`;
      return { content: [{ type: 'text' as const, text: JSON.stringify({ newSession: newSessionName, compositeId, cwd }) }] };
    }
  );

  server.registerTool(
    'list_clients',
    {
      description: 'セッションの tmux クライアント一覧を取得する。危険度: read。前提: id が必須。',
      inputSchema: z.object({
        id: z.string().describe('compositeId'),
      }).strict(),
      annotations: { readOnlyHint: true },
    },
    async (args: any) => {
      const pool = getPool();
      const { provider, sessionName } = pool.resolve(args.id);
      const output = provider.exec(['list-clients', '-t', sessionName, '-F', '#{client_name}\t#{client_pid}\t#{client_tty}\t#{client_width}x#{client_height}\t#{client_created}\t#{client_activity}']);
      const clients = output ? output.split('\n').map((line: string) => {
        const [name, pid, tty, size, created, activity] = line.split('\t');
        return { name, pid: Number.parseInt(pid || '0', 10) || 0, tty, size, created: Number.parseInt(created || '0', 10) || 0, activity: Number.parseInt(activity || '0', 10) || 0 };
      }) : [];
      return { content: [{ type: 'text' as const, text: JSON.stringify({ sessionId: args.id, clients }) }] };
    }
  );

  server.registerTool(
    'control_clients',
    {
      description: 'tmux クライアントを detach / detach-all / kill する。危険度: destructive（kill のみ）。confirm=false（既定）なら対象一覧のみ。kill は confirm 必須。',
      inputSchema: z.object({
        id: z.string().describe('compositeId'),
        action: z.enum(['detach', 'detach-all', 'kill']).describe('アクション'),
        tty: z.string().optional().describe('detach 対象の tty'),
        pid: z.number().optional().describe('kill 対象の pid'),
        confirm: z.boolean().optional().describe('true で実行。kill は必須。detach/detach-all は不要'),
      }).strict(),
      annotations: { destructiveHint: true },
    },
    async (args: any) => {
      const pool = getPool();
      const { provider, sessionName } = pool.resolve(args.id);
      const { action, tty, pid } = args;

      if (action === 'kill' && !args.confirm) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ dryRun: true, id: args.id, action, pid, message: 'confirm: true で実行します' }) }] };
      }

      if (action === 'detach-all') {
        const output = provider.exec(['list-clients', '-t', sessionName, '-F', '#{client_tty}']);
        const ttys = output ? output.split('\n').filter(Boolean) : [];
        for (const currentTty of ttys) provider.exec(['detach-client', '-t', currentTty]);
        return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, action, sessionId: args.id, detached: ttys }) }] };
      }

      if (action === 'detach') {
        if (!tty) throw new Error('tty is required for detach');
        provider.exec(['detach-client', '-t', tty]);
        return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, action, tty, sessionId: args.id }) }] };
      }

      if (action === 'kill') {
        const targetPid = Number.parseInt(String(pid || 0), 10);
        if (!targetPid) throw new Error('pid is required for kill');
        process.kill(targetPid, 'SIGTERM');
        return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, action, pid: targetPid, sessionId: args.id }) }] };
      }

      throw new Error('unsupported action');
    }
  );

  server.registerTool(
    'set_auto_accept',
    {
      description: 'Commander Agent の auto-accept を有効化/無効化する。危険度: write。前提: commanderSessionId と enabled が必須。enabled=true なら targetSessionId も必須。',
      inputSchema: z.object({
        commanderSessionId: z.string().describe('Commander セッション ID'),
        enabled: z.boolean().describe('true で有効化'),
        targetSessionId: z.string().optional().describe('対象セッション ID（enabled=true のとき必須）'),
      }).strict(),
      annotations: {},
    },
    async (args: any) => {
      const { commanderSessionId, enabled, targetSessionId } = args;
      if (enabled && !targetSessionId) throw new Error('targetSessionId is required when enabling auto-accept');
      const pool = getPool();
      if (enabled) {
        pool.resolve(commanderSessionId);
        pool.resolve(targetSessionId);
        sessionStore.linkCommander(commanderSessionId, targetSessionId);
        autoAcceptManager.start(commanderSessionId, targetSessionId, pool);
        return { content: [{ type: 'text' as const, text: JSON.stringify({ message: 'Auto-accept enabled', commanderSessionId, targetSessionId }) }] };
      }
      autoAcceptManager.stop(commanderSessionId);
      sessionStore.unlinkCommander(commanderSessionId);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ message: 'Auto-accept disabled', commanderSessionId }) }] };
    }
  );

  server.registerTool(
    'get_auto_accept',
    {
      description: 'Commander Agent の auto-accept 状態を取得する。危険度: read。前提: commanderSessionId が必須。',
      inputSchema: z.object({
        commanderSessionId: z.string().describe('Commander セッション ID'),
      }).strict(),
      annotations: { readOnlyHint: true },
    },
    async (args: any) => {
      const { commanderSessionId } = args;
      const isActive = autoAcceptManager.isActive(commanderSessionId);
      const metadata = sessionStore.getMetadata(commanderSessionId);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ commanderSessionId, enabled: isActive, targetSessionId: metadata.linkedSessionId, role: metadata.role }) }] };
    }
  );

  server.registerTool(
    'list_templates',
    {
      description: 'エージェントテンプレート一覧を取得する。危険度: read。前提: なし。',
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true },
    },
    async () => {
      if (!fs.existsSync(USER_TEMPLATES_DIR)) fs.ensureDirSync(USER_TEMPLATES_DIR);
      const names = fs.readdirSync(USER_TEMPLATES_DIR);
      const templates = names.map(name => {
        const descPath = path.join(USER_TEMPLATES_DIR, name, 'description.md');
        const description = fs.existsSync(descPath) ? fs.readFileSync(descPath, 'utf-8') : '';
        return { name, description };
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify({ templates }) }] };
    }
  );

  server.registerResource(
    'spec',
    'workos://spec',
    { description: 'Work OS の能力仕様（機械可読）', mimeType: 'application/json' },
    async () => ({ contents: [{ uri: 'workos://spec', mimeType: 'application/json', text: JSON.stringify(buildSpec(server), null, 2) }] })
  );

  server.registerResource(
    'guide',
    'workos://guide',
    { description: 'Work OS MCP の使い方ガイド', mimeType: 'text/markdown' },
    async () => ({ contents: [{ uri: 'workos://guide', mimeType: 'text/markdown', text: buildGuide() }] })
  );

  return server;
}

export function mountMcp(app: Express): void {
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  app.post('/mcp', async (req: any, res: any) => {
    const sessionIdHeader = req.headers['mcp-session-id'] as string | undefined;

    if (sessionIdHeader && sessions.has(sessionIdHeader)) {
      const transport = sessions.get(sessionIdHeader)!;
      await transport.handleRequest(req, res, req.body);
      return;
    }

    if (sessionIdHeader) {
      res.status(400).json({ error: 'Invalid session ID' });
      return;
    }

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID() });
    const server = createMcpServer();
    await server.connect(transport);

    transport.onclose = () => {
      const sid = (transport as any).sessionId;
      if (sid) sessions.delete(sid);
    };

    await transport.handleRequest(req, res, req.body);

    const newSid = (transport as any).sessionId;
    if (newSid) sessions.set(newSid, transport);
  });

  app.get('/mcp', async (req: any, res: any) => {
    const sessionIdHeader = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionIdHeader || !sessions.has(sessionIdHeader)) {
      res.status(400).json({ error: 'Invalid session ID for GET' });
      return;
    }
    const transport = sessions.get(sessionIdHeader)!;
    await transport.handleRequest(req, res);
  });

  app.delete('/mcp', async (req: any, res: any) => {
    const sessionIdHeader = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionIdHeader || !sessions.has(sessionIdHeader)) {
      res.status(400).json({ error: 'Invalid session ID for DELETE' });
      return;
    }
    const transport = sessions.get(sessionIdHeader)!;
    await transport.handleRequest(req, res);
  });
}
