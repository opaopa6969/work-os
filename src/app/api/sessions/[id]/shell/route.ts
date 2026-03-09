import { NextResponse } from 'next/server';
import { execSync, spawnSync } from 'child_process';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const SOCKET = '/tmp/tmux-1000/default';

  try {
    // 1. 指定されたセッションの現在のパス(CWD)を取得
    // #{pane_current_path} は tmux の組み込み変数
    const cwd = execSync(`tmux -S ${SOCKET} display-message -p -t "${id}" "#{pane_current_path}"`, { encoding: 'utf-8' }).trim();

    // 2. 新しいセッション名を生成 (sh-元の名前-時刻)
    const newSessionName = `sh-${id}-${Date.now().toString().slice(-4)}`;

    // 3. そのパスで bash セッションを起動
    const args = ['-S', SOCKET, 'new-session', '-d', '-s', newSessionName, '-c', cwd, 'bash'];
    const result = spawnSync('tmux', args, { encoding: 'utf-8' });

    if (result.error) {
      throw result.error;
    }

    return NextResponse.json({ 
      message: `Opened shell in ${cwd}`,
      newSession: newSessionName,
      cwd
    });
  } catch (error: any) {
    return NextResponse.json({ 
      error: `Failed to open shell for session: ${id}`, 
      details: error.message 
    }, { status: 500 });
  }
}
