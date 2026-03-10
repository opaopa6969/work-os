import { NextResponse } from 'next/server';
import { execSync } from 'child_process';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const TMUX_SOCKET = process.env.TMUX_SOCKET || '';
  const getTmuxCmd = (cmd: string) => TMUX_SOCKET ? `tmux -S ${TMUX_SOCKET} ${cmd}` : `tmux ${cmd}`;

  try {
    let output = '';
    try {
      output = execSync(getTmuxCmd(`capture-pane -a -e -J -p -t "${id}"`), { encoding: 'utf-8' });
    } catch {
      output = execSync(getTmuxCmd(`capture-pane -e -J -p -t "${id}"`), { encoding: 'utf-8' });
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
  const TMUX_SOCKET = process.env.TMUX_SOCKET || '';
  const getTmuxCmd = (cmd: string) => TMUX_SOCKET ? `tmux -S ${TMUX_SOCKET} ${cmd}` : `tmux ${cmd}`;
  try {
    execSync(getTmuxCmd(`kill-session -t "${id}"`));
    return NextResponse.json({ message: `Session ${id} killed` });
  } catch (error: any) {
    return NextResponse.json({ error: `Failed to kill tmux session: ${id}`, details: error.message }, { status: 500 });
  }
}
