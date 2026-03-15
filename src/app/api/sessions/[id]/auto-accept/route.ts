import { NextResponse } from 'next/server';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const commanderSessionId = id;
  try {
    const { enabled, targetSessionId } = await request.json();

    if (typeof enabled !== 'boolean') {
      return NextResponse.json(
        { error: 'enabled (boolean) is required' },
        { status: 400 }
      );
    }

    if (enabled && !targetSessionId) {
      return NextResponse.json(
        { error: 'targetSessionId is required when enabling auto-accept' },
        { status: 400 }
      );
    }

    // Import here to avoid circular dependency issues
    const { autoAcceptManager } = await import('@/lib/auto-accept');
    const { buildSessionPool } = await import('@/lib/tmux-provider');
    const { sessionStore } = await import('@/lib/session-store');

    const pool = buildSessionPool();

    if (enabled) {
      // Validate that both sessions exist
      try {
        pool.resolve(commanderSessionId);
        pool.resolve(targetSessionId);
      } catch (e) {
        return NextResponse.json(
          { error: 'One or both sessions not found' },
          { status: 404 }
        );
      }

      // Link the sessions
      sessionStore.linkCommander(commanderSessionId, targetSessionId);

      // Start auto-accept polling
      autoAcceptManager.start(commanderSessionId, targetSessionId, pool);

      return NextResponse.json({
        message: 'Auto-accept enabled',
        commanderSessionId,
        targetSessionId,
      });
    } else {
      // Stop auto-accept polling
      autoAcceptManager.stop(commanderSessionId);
      sessionStore.unlinkCommander(commanderSessionId);

      return NextResponse.json({
        message: 'Auto-accept disabled',
        commanderSessionId,
      });
    }
  } catch (error: any) {
    console.error('[auto-accept] Error:', error);
    return NextResponse.json(
      { error: 'Failed to configure auto-accept', details: error.message },
      { status: 500 }
    );
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const commanderSessionId = id;
    const { autoAcceptManager } = await import('@/lib/auto-accept');
    const { sessionStore } = await import('@/lib/session-store');

    const isActive = autoAcceptManager.isActive(commanderSessionId);
    const metadata = sessionStore.getMetadata(commanderSessionId);

    return NextResponse.json({
      commanderSessionId,
      enabled: isActive,
      targetSessionId: metadata.linkedSessionId,
      role: metadata.role,
    });
  } catch (error: any) {
    console.error('[auto-accept] GET Error:', error);
    return NextResponse.json(
      { error: 'Failed to get auto-accept status', details: error.message },
      { status: 500 }
    );
  }
}
