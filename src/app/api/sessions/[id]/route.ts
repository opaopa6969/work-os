import { NextResponse } from 'next/server';
import { buildSessionPool } from '@/lib/tmux-provider';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const pool = buildSessionPool();

  try {
    const { provider, sessionName } = pool.resolve(id);
    let output = '';
    try {
      output = provider.exec(['capture-pane', '-a', '-e', '-J', '-p', '-t', sessionName]);
    } catch {
      output = provider.exec(['capture-pane', '-e', '-J', '-p', '-t', sessionName]);
    }

    const lines = output.trim().split('\n');
    const lastLines = lines.slice(-5).join(' ').toLowerCase();

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
  const pool = buildSessionPool();
  try {
    const { provider, sessionName } = pool.resolve(id);
    provider.exec(['kill-session', '-t', sessionName]);
    return NextResponse.json({ message: `Session ${id} killed` });
  } catch (error: any) {
    return NextResponse.json({ error: `Failed to kill tmux session: ${id}`, details: error.message }, { status: 500 });
  }
}
