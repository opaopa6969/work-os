import { NextResponse } from 'next/server';
import { execFileSync } from 'child_process';
import fs from 'fs-extra';
import path from 'path';

const USER_TEMPLATES_DIR = path.join(process.cwd(), 'templates/user');
const DEFAULT_TEMPLATES_DIR = path.join(process.cwd(), 'templates/defaults');
const RUNTIME_SESSIONS_DIR = process.env.WORK_OS_RUNTIME_DIR || '/tmp/workos-runtime/sessions';

const TMUX_SOCKET = process.env.TMUX_SOCKET || '';

function getTmuxArgs(args: string[]) {
  return TMUX_SOCKET ? ['-S', TMUX_SOCKET, ...args] : args;
}

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

function shellEscape(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
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
  try {
    const output = execFileSync(
      'tmux',
      getTmuxArgs([
        'ls',
        '-F',
        '#{session_name}\t#{session_created}\t#{session_attached}\t#{@workos_command}\t#{@workos_directory}\t#{@workos_role}\t#{@workos_instruction_path}',
      ]),
      {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }
    );

    const sessions = output
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name, created, attached, command, directory, role, instructionPath] = line.split('\t');
        const currentCommand = execFileSync(
          'tmux',
          getTmuxArgs(['display-message', '-p', '-t', name, '#{pane_current_command}']),
          { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }
        ).trim();
        const currentPath = execFileSync(
          'tmux',
          getTmuxArgs(['display-message', '-p', '-t', name, '#{pane_current_path}']),
          { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }
        ).trim();
        const clientLines = execFileSync(
          'tmux',
          getTmuxArgs(['list-clients', '-t', name, '-F', '#{client_tty}']),
          { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }
        ).trim();
        const clientCount = clientLines ? clientLines.split('\n').filter(Boolean).length : 0;
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
    const finalCommand = runtimeInstruction
      ? `${String(command)} ${shellEscape(runtimeInstruction.instructionPath)}`
      : String(command);

    execFileSync(
      'tmux',
      getTmuxArgs(['new-session', '-d', '-s', sessionName, '-c', cwd, finalCommand]),
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    execFileSync('tmux', getTmuxArgs(['set-option', '-t', sessionName, '@workos_command', String(command)]), {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    execFileSync('tmux', getTmuxArgs(['set-option', '-t', sessionName, '@workos_directory', String(cwd)]), {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    execFileSync(
      'tmux',
      getTmuxArgs(['set-option', '-t', sessionName, '@workos_role', templateName ? String(templateName) : '']),
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    execFileSync(
      'tmux',
      getTmuxArgs([
        'set-option',
        '-t',
        sessionName,
        '@workos_instruction_path',
        runtimeInstruction ? runtimeInstruction.instructionPath : '',
      ]),
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    return NextResponse.json({
      message: `Session ${sessionName} started`,
      sessionName,
      cwd,
      command: finalCommand,
      instructionPath: runtimeInstruction?.instructionPath || null,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to start tmux session', details: error.message },
      { status: 500 }
    );
  }
}
