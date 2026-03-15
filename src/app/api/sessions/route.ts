import { NextResponse } from 'next/server';
import fs from 'fs-extra';
import path from 'path';
import { buildSessionPool } from '@/lib/tmux-provider';
import { sessionStore } from '@/lib/session-store';

const USER_TEMPLATES_DIR = path.join(process.cwd(), 'templates/user');
const DEFAULT_TEMPLATES_DIR = path.join(process.cwd(), 'templates/defaults');
const RUNTIME_SESSIONS_DIR = process.env.WORK_OS_RUNTIME_DIR || '/tmp/workos-runtime/sessions';

function sanitizeSessionName(input: string) {
  return input.trim().replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 120);
}

function resolveTemplateDir(templateName?: string) {
  if (!templateName) {
    return null;
  }

  const userPath = path.join(USER_TEMPLATES_DIR, templateName);
  if (fs.existsSync(userPath)) {
    return userPath;
  }

  const match = templateName.match(/^(.*)-([a-z]{2})$/i);
  if (match) {
    const [, baseName, lang] = match;
    const defaultPath = path.join(DEFAULT_TEMPLATES_DIR, lang, baseName);
    if (fs.existsSync(defaultPath)) {
      return defaultPath;
    }
  }

  return null;
}


async function buildRuntimeInstruction(
  templateDir: string,
  sessionName: string,
  cwd: string,
  command: string,
  roleName: string
) {
  const runtimeDir = path.join(RUNTIME_SESSIONS_DIR, sessionName);
  const instructionPath = path.join(runtimeDir, 'AGENT.MD');
  const metadataPath = path.join(runtimeDir, 'session.json');

  await fs.ensureDir(runtimeDir);

  const templateInstructionPath = path.join(templateDir, 'AGENT.MD');
  const templateInstruction = (await fs.pathExists(templateInstructionPath))
    ? await fs.readFile(templateInstructionPath, 'utf-8')
    : '';

  const baselineDocs = ['README.md', 'specs.md', 'architecture.md', 'backlog.md', 'CHANGELOG.md'];
  const existingDocs = baselineDocs.filter((file) => fs.existsSync(path.join(cwd, file)));
  const docsBulletList = existingDocs.length
    ? existingDocs.map((file) => `- ${path.join(cwd, file)}`).join('\n')
    : '- 既知の baseline docs は見つからなければ無理に作らない';

  const runtimeInstruction = `# Work OS Runtime Role

## Session Context
- Session Name: ${sessionName}
- Working Directory: ${cwd}
- Command: ${command}
- Selected Role: ${roleName}

## Operating Rules
- このファイルは session 専用の runtime instruction です。
- project directory へ role template を直接 merge しないでください。
- まず project baseline docs を読んで、現在のプロジェクト方針を把握してください。
- role の振る舞いはこの runtime instruction に従ってください。

## Project Baseline Docs
${docsBulletList}

## Role Template
${templateInstruction.trim() || 'この role には追加テンプレート本文がありません。'}
`;

  await fs.writeFile(instructionPath, runtimeInstruction.trimEnd() + '\n', 'utf-8');
  await fs.writeJson(
    metadataPath,
    {
      sessionName,
      cwd,
      command,
      roleName,
      instructionPath,
      generatedAt: new Date().toISOString(),
    },
    { spaces: 2 }
  );

  return { runtimeDir, instructionPath };
}

export async function GET() {
  const pool = buildSessionPool();
  console.log(`[API/sessions] Fetching sessions from ${pool.getAllProviders().length} provider(s)`);

  // 並行処理：すべてのホストのセッションを同時に取得
  const results = await Promise.allSettled(
    pool.getAllProviders().map(async (provider) => {
      const sessions = [];
      try {
        console.log(`[API/sessions] Fetching from provider: ${provider.hostId} (${provider.displayName})`);
        const output = provider.exec([
          'ls',
          '-F',
          '#{session_name}__WORKOS__#{session_created}__WORKOS__#{session_attached}__WORKOS__#{@workos_command}__WORKOS__#{@workos_directory}__WORKOS__#{@workos_role}__WORKOS__#{@workos_instruction_path}',
        ]);

        console.log(`[API/sessions] Raw output from ${provider.hostId}:`, JSON.stringify(output.substring(0, 200)));
        const lines = output
            .trim()
            .split('\n')
            .filter(Boolean);
        console.log(`[API/sessions] Parsed ${lines.length} session lines from ${provider.hostId}`);

        sessions.push(
          ...lines
            .map((line) => {
              const [name, created, attached, command, directory, role, instructionPath] = line.split('__WORKOS__');
              const currentCommand = provider.exec(['display-message', '-p', '-t', name, '#{pane_current_command}']);
              const currentPath = provider.exec(['display-message', '-p', '-t', name, '#{pane_current_path}']);

              let clientOutput = '';
              try {
                clientOutput = provider.exec([
                  'list-clients',
                  '-t',
                  name,
                  '-F',
                  '#{client_tty}__WORKOS__#{client_activity}',
                ]);
              } catch {
                clientOutput = '';
              }

              const clientRows = clientOutput
                ? clientOutput
                    .split('\n')
                    .filter(Boolean)
                    .map((row) => {
                      const [, activity] = row.split('__WORKOS__');
                      return Number.parseInt(activity || '0', 10) || 0;
                    })
                : [];
              const clientCount = clientRows.length;
              const lastActivity = clientRows.length ? Math.max(...clientRows) : Number(created);
              const lowerCommand = (currentCommand || command || '').toLowerCase();
              const suggestedMode =
                attached === '1'
                  ? 'mirror'
                  : ['bash', 'sh', 'zsh', 'fish'].includes(lowerCommand) || name.startsWith('sh-')
                    ? 'attach'
                    : 'mirror';
              const compositeId = `${provider.hostId}:${name}`;
              const metadata = sessionStore.getMetadata(compositeId);
              return {
                id: compositeId,
                name,
                hostId: provider.hostId,
                hostName: provider.displayName,
                created: Number(created),
                isAttached: attached === '1',
                command: command || '',
                directory: directory || '',
                role: role || '',
                instructionPath: instructionPath || '',
                currentCommand,
                currentPath,
                clientCount,
                lastActivity,
                suggestedMode,
                // Commander agent fields
                sessionRole: metadata.role,
                linkedSessionId: metadata.linkedSessionId,
              };
            })
        );
      } catch (error: any) {
        const message = error.message || '';
        console.error(`[API/sessions] Error from ${provider.hostId}:`, message, error.stack);
        if (!message.includes('no server running') && !message.includes('error connecting') && !message.includes('failed to connect')) {
          console.warn(`[API] sessions GET error on ${provider.hostId}:`, message);
        }
      }
      console.log(`[API/sessions] Provider ${provider.hostId} returned ${sessions.length} sessions`);
      return sessions;
    })
  );

  const allSessions = results
    .filter((r) => r.status === 'fulfilled')
    .flatMap((r) => (r.status === 'fulfilled' ? r.value : []));

  console.log(`[API/sessions] Total sessions from all providers: ${allSessions.length}`);
  return NextResponse.json({ sessions: allSessions });
}

export async function POST(request: Request) {
  const pool = buildSessionPool();
  try {
    const { name, command, cwd, templateName, hostId = 'local', linkedSessionId, sessionRole } = await request.json();

    if (!name || !command || !cwd) {
      return NextResponse.json(
        { error: 'name, command, and cwd are required' },
        { status: 400 }
      );
    }

    const sessionName = sanitizeSessionName(String(name));
    if (!sessionName) {
      return NextResponse.json({ error: 'invalid session name' }, { status: 400 });
    }

    const provider = pool.getProvider(String(hostId));
    if (!provider) {
      return NextResponse.json(
        { error: `host not found: ${hostId}` },
        { status: 400 }
      );
    }

    await fs.ensureDir(cwd);

    const templateDir = resolveTemplateDir(templateName);
    const runtimeInstruction = templateDir
      ? await buildRuntimeInstruction(templateDir, sessionName, cwd, String(command), String(templateName))
      : null;

    // Build new-session args: command args are split by whitespace since tmux expects them as separate tokens
    const cmdTokens = runtimeInstruction
      ? [String(command), runtimeInstruction.instructionPath]
      : String(command).split(/\s+/);
    provider.exec(['new-session', '-d', '-s', sessionName, '-c', String(cwd), ...cmdTokens]);

    const finalCommand = cmdTokens.join(' ');

    provider.exec(['set-option', '-t', sessionName, '@workos_command', String(command)]);
    provider.exec(['set-option', '-t', sessionName, '@workos_directory', String(cwd)]);
    provider.exec(['set-option', '-t', sessionName, '@workos_role', templateName ? String(templateName) : '']);
    provider.exec(['set-option', '-t', sessionName, '@workos_instruction_path', runtimeInstruction ? runtimeInstruction.instructionPath : '']);

    const compositeId = `${provider.hostId}:${sessionName}`;

    // Handle session linking for commander sessions
    if (sessionRole && linkedSessionId) {
      if (sessionRole === 'commander') {
        sessionStore.linkCommander(compositeId, linkedSessionId);
      } else if (sessionRole === 'target') {
        sessionStore.setMetadata(compositeId, {
          role: 'target',
          linkedSessionId,
        });
      }
    }

    return NextResponse.json({
      message: `Session ${sessionName} started on ${provider.displayName}`,
      compositeId,
      sessionName,
      hostId: provider.hostId,
      cwd,
      command: finalCommand,
      instructionPath: runtimeInstruction?.instructionPath ?? null,
      sessionRole: sessionRole || undefined,
      linkedSessionId: linkedSessionId || undefined,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to start tmux session', details: error.message },
      { status: 500 }
    );
  }
}
