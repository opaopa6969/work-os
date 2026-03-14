import { NextResponse } from 'next/server';
import { buildSessionPool } from '@/lib/tmux-provider';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const pool = buildSessionPool();

  try {
    const { provider, sessionName } = pool.resolve(id);

    // 1. 指定されたセッションの現在のパス(CWD)を取得
    const cwd = provider.exec(['display-message', '-p', '-t', sessionName, '#{pane_current_path}']);

    // 2. 新しいセッション名を生成 (sh-元の名前-時刻)
    const newSessionName = `sh-${sessionName}-${Date.now().toString().slice(-4)}`;

    // 3. そのパスで bash セッションを起動
    provider.exec(['new-session', '-d', '-s', newSessionName, '-c', cwd, 'bash']);

    const compositeId = `${provider.hostId}:${newSessionName}`;
    return NextResponse.json({
      message: `Opened shell in ${cwd}`,
      newSession: newSessionName,
      compositeId,
      cwd
    });
  } catch (error: any) {
    return NextResponse.json({
      error: `Failed to open shell for session: ${id}`,
      details: error.message
    }, { status: 500 });
  }
}
