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
    const output = execSync(
      getTmuxCmd(`list-clients -t "${id}" -F "#{client_name}\t#{client_pid}\t#{client_tty}\t#{client_width}x#{client_height}\t#{client_created}\t#{client_activity}\t#{client_termname}"`),
      { encoding: 'utf-8' }
    ).trim();

    const clients = output
      ? output.split('\n').map((line) => {
          const [name, pid, tty, size, created, activity, termname] = line.split('\t');
          return {
            name,
            pid: Number.parseInt(pid || '0', 10) || 0,
            tty,
            size,
            created: Number.parseInt(created || '0', 10) || 0,
            activity: Number.parseInt(activity || '0', 10) || 0,
            termname,
            raw: line,
          };
        })
      : [];

    return NextResponse.json({
      sessionId: id,
      clients,
      raw: output,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: `Failed to list tmux clients: ${id}`, details: error.message },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const TMUX_SOCKET = process.env.TMUX_SOCKET || '';
  const getTmuxCmd = (cmd: string) => TMUX_SOCKET ? `tmux -S ${TMUX_SOCKET} ${cmd}` : `tmux ${cmd}`;

  try {
    const { action, tty, pid } = await request.json();

    if (action === 'detach-all') {
      const output = execSync(
        getTmuxCmd(`list-clients -t "${id}" -F "#{client_tty}"`),
        { encoding: 'utf-8' }
      ).trim();
      const ttys = output ? output.split('\n').filter(Boolean) : [];
      for (const currentTty of ttys) {
        execSync(getTmuxCmd(`detach-client -t "${currentTty}"`), { encoding: 'utf-8' });
      }
      return NextResponse.json({ ok: true, action, sessionId: id, detached: ttys });
    }

    if (action === 'detach') {
      if (!tty) {
        return NextResponse.json({ error: 'tty is required' }, { status: 400 });
      }
      execSync(getTmuxCmd(`detach-client -t "${tty}"`), { encoding: 'utf-8' });
      return NextResponse.json({ ok: true, action, tty, sessionId: id });
    }

    if (action === 'kill') {
      const targetPid = Number.parseInt(String(pid || 0), 10);
      if (!targetPid) {
        return NextResponse.json({ error: 'pid is required' }, { status: 400 });
      }
      process.kill(targetPid, 'SIGTERM');
      return NextResponse.json({ ok: true, action, pid: targetPid, sessionId: id });
    }

    return NextResponse.json({ error: 'unsupported action' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json(
      { error: `Failed to control tmux clients: ${id}`, details: error.message },
      { status: 500 }
    );
  }
}
