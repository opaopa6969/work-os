import { NextResponse } from 'next/server';
import { execSync } from 'child_process';
import fs from 'fs-extra';
import path from 'path';

const USER_TEMPLATES_DIR = path.join(process.cwd(), 'templates/user');

const TMUX_SOCKET = process.env.TMUX_SOCKET || '';
const getTmuxCmd = (cmd: string) => TMUX_SOCKET ? `tmux -S ${TMUX_SOCKET} ${cmd}` : `tmux ${cmd}`;

export async function GET() {
  try {
    const output = execSync(getTmuxCmd("ls -F '#{session_name},#{session_created},#{session_attached}'"), { encoding: 'utf-8' });
    
    const sessions = output.trim().split('\n').map(line => {
      const [name, created, attached] = line.split(',');
      return {
        id: name,
        name,
        created: parseInt(created, 10),
        isAttached: attached === '1',
      };
    });

    return NextResponse.json({ sessions });
  } catch (error: any) {
    if (error.message.includes('error connecting to')) {
      return NextResponse.json({ sessions: [] });
    }
    return NextResponse.json({ error: 'Failed to list tmux sessions', details: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { name, command, cwd, templateName } = await request.json();

    if (!name || !command) {
      return NextResponse.json({ error: 'Name and command are required' }, { status: 400 });
    }

    // テンプレートの適用
    if (templateName && cwd) {
      const templatePath = path.join(USER_TEMPLATES_DIR, templateName);
      if (fs.existsSync(templatePath)) {
        await fs.ensureDir(cwd);
        // テンプレートの中身を cwd にコピー (AGENT.MD 等)
        // 既存ファイルを壊さないように overwrite: false
        await fs.copy(templatePath, cwd, { overwrite: false });
      }
    }

    // 新しい tmux セッションをバックグラウンドで開始
    const SOCKET = '/tmp/tmux-1000/default';
    const dirOption = cwd ? `-c "${cwd}"` : '';
    
    // エージェントコマンドの構築
    // テンプレート適用時は AGENT.MD を自動的に読み込ませる引数を追加
    const finalCommand = templateName ? `${command} AGENT.MD` : command;

    execSync(getTmuxCmd(`new-session -d -s "${name}" ${dirOption} "${finalCommand}"`));

    return NextResponse.json({ message: `Session ${name} started` });
  } catch (error: any) {
    return NextResponse.json({ error: 'Failed to start tmux session', details: error.message }, { status: 500 });
  }
}
