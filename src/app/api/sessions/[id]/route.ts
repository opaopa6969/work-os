import { NextResponse } from 'next/server';
import { execSync } from 'child_process';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    // 指定したセッションのペインをキャプチャして取得
    const output = execSync(`tmux -S /tmp/tmux-1000/default capture-pane -pt "${id}"`, { encoding: 'utf-8' });

    // 入力待ち判定ロジック (y/n, [y/N], Proceed?, 1. Allow once, etc.)
    const lines = output.trim().split('\n');
    const lastLines = lines.slice(-5).join(' ').toLowerCase(); // より広範囲をチェック
    
    const isWaitingForInput = 
      /([\[\(][y\/n]+[\)\]]|\? |proceed\?|continue\?|ready\?)/i.test(lastLines) ||
      /(● \d\. |[1-9]\. allow|[1-9]\. yes|[1-9]\. proceed)/i.test(lastLines);

    return NextResponse.json({ 
      id, 
      content: output,
      isWaitingForInput,
      lastLine: lines[lines.length - 1] || '',
      updatedAt: Date.now()
    });
  } catch (error: any) {
    return NextResponse.json({ error: `Failed to capture tmux session: ${id}`, details: error.message }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    execSync(`tmux kill-session -t "${id}"`);
    return NextResponse.json({ message: `Session ${id} killed` });
  } catch (error: any) {
    return NextResponse.json({ error: `Failed to kill tmux session: ${id}`, details: error.message }, { status: 500 });
  }
}
