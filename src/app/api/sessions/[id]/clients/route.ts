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
