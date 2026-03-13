import { NextResponse } from 'next/server';
import { resolveTmuxProvider } from '@/lib/tmux-provider';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tmux = resolveTmuxProvider();

  try {
    let output = '';
    try {
      output = tmux.exec(['capture-pane', '-a', '-e', '-J', '-p', '-t', id]);
    } catch {
      output = tmux.exec(['capture-pane', '-e', '-J', '-p', '-t', id]);
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
  const tmux = resolveTmuxProvider();
  try {
    tmux.exec(['kill-session', '-t', id]);
    return NextResponse.json({ message: `Session ${id} killed` });
  } catch (error: any) {
    return NextResponse.json({ error: `Failed to kill tmux session: ${id}`, details: error.message }, { status: 500 });
  }
}
