import { NextResponse } from 'next/server';
import { resolveTmuxProvider } from '@/lib/tmux-provider';

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

    const tmux = resolveTmuxProvider();
    tmux.exec(['send-keys', '-t', id, key]);

    return NextResponse.json({
      message: `Sent key: ${key} to session: ${id}`,
    });
  } catch (error: any) {
    return NextResponse.json({ error: `Failed to send key to session: ${id}`, details: error.message }, { status: 500 });
  }
}
