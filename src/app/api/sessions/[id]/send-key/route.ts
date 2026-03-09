import { NextResponse } from 'next/server';
import { spawnSync } from 'child_process';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  
  try {
    const { key } = await request.json();

    if (!key) {
      return NextResponse.json({ error: 'Key is required' }, { status: 400 });
    }

    // spawnSync を使い、シェルを介さずに引数を直接渡す
    // 特殊キー（Enter, Up, Down）はそのまま、それ以外もリテラルとして渡す
    const args = ['-S', '/tmp/tmux-1000/default', 'send-keys', '-t', id, key];
    
    const result = spawnSync('tmux', args, { encoding: 'utf-8' });

    if (result.error) {
      throw result.error;
    }

    return NextResponse.json({ 
      message: `Sent key: ${key} to session: ${id}`,
      status: result.status 
    });
  } catch (error: any) {
    return NextResponse.json({ error: `Failed to send key to session: ${id}`, details: error.message }, { status: 500 });
  }
}
