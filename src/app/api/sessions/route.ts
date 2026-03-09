import { NextResponse } from 'next/server';
import { execSync } from 'child_process';

export async function GET() {
  try {
    // tmux ls を実行し、必要な情報をカンマ区切りで取得
    // フォーマット: session_name, session_created, session_attached
    const output = execSync("tmux -S /tmp/tmux-1000/default ls -F '#{session_name},#{session_created},#{session_attached}'", { encoding: 'utf-8' });
    
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
    // tmux が起動していない場合は空の配列を返すか、エラーを返す
    if (error.message.includes('error connecting to')) {
      return NextResponse.json({ sessions: [] });
    }
    return NextResponse.json({ error: 'Failed to list tmux sessions', details: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { name, command, cwd } = await request.json();

    if (!name || !command) {
      return NextResponse.json({ error: 'Name and command are required' }, { status: 400 });
    }

    // 新しい tmux セッションをバックグラウンドで開始
    // -d: デタッチ状態で開始, -s: セッション名, -c: 開始ディレクトリ
    const dirOption = cwd ? `-c "${cwd}"` : '';
    execSync(`tmux new-session -d -s "${name}" ${dirOption} "${command}"`);

    return NextResponse.json({ message: `Session ${name} started in ${cwd || 'default dir'} with command: ${command}` });
  } catch (error: any) {
    return NextResponse.json({ error: 'Failed to start tmux session', details: error.message }, { status: 500 });
  }
}
