import { NextResponse } from 'next/server';
import fs from 'fs-extra';
import path from 'path';
import { resolveTmuxProvider } from '@/lib/tmux-provider';

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
  const tmux = resolveTmuxProvider();
  try {
    const output = tmux.exec([
      'ls',
      '-F',
      '#{session_name}__WORKOS__#{session_created}__WORKOS__#{session_attached}__WORKOS__#{@workos_command}__WORKOS__#{@workos_directory}__WORKOS__#{@workos_role}__WORKOS__#{@workos_instruction_path}',
    ]);

    const sessions = output
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name, created, attached, command, directory, role, instructionPath] = line.split('__WORKOS__');
        const currentCommand = tmux.exec(['display-message', '-p', '-t', name, '#{pane_current_command}']);
        const currentPath = tmux.exec(['display-message', '-p', '-t', name, '#{pane_current_path}']);

        let clientOutput = '';
        try {
          clientOutput = tmux.exec([
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
        return {
          id: name,
          name,
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
        };
      });

    return NextResponse.json({ sessions });
  } catch (error: any) {
    const message = error.message || '';
    if (
      message.includes('no server running') ||
      message.includes('error connecting') ||
      message.includes('failed to connect')
    ) {
      return NextResponse.json({ sessions: [] });
    }
    console.error('[API] sessions GET error:', message);
    return NextResponse.json({ sessions: [] });
  }
}

export async function POST(request: Request) {
  const tmux = resolveTmuxProvider();
  try {
    const { name, command, cwd, templateName } = await request.json();

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

    await fs.ensureDir(cwd);

    const templateDir = resolveTemplateDir(templateName);
    const runtimeInstruction = templateDir
      ? await buildRuntimeInstruction(templateDir, sessionName, cwd, String(command), String(templateName))
      : null;

    // Build new-session args: command args are split by whitespace since tmux expects them as separate tokens
    const cmdTokens = runtimeInstruction
      ? [String(command), runtimeInstruction.instructionPath]
      : String(command).split(/\s+/);
    tmux.exec(['new-session', '-d', '-s', sessionName, '-c', String(cwd), ...cmdTokens]);

    const finalCommand = cmdTokens.join(' ');

    tmux.exec(['set-option', '-t', sessionName, '@workos_command', String(command)]);
    tmux.exec(['set-option', '-t', sessionName, '@workos_directory', String(cwd)]);
    tmux.exec(['set-option', '-t', sessionName, '@workos_role', templateName ? String(templateName) : '']);
    tmux.exec(['set-option', '-t', sessionName, '@workos_instruction_path', runtimeInstruction ? runtimeInstruction.instructionPath : '']);

    return NextResponse.json({
      message: `Session ${sessionName} started`,
      sessionName,
      cwd,
      command: finalCommand,
      instructionPath: runtimeInstruction?.instructionPath ?? null,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to start tmux session', details: error.message },
      { status: 500 }
    );
  }
}
