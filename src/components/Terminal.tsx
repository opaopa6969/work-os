'use client';

import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { io, Socket } from 'socket.io-client';
import 'xterm/css/xterm.css';

interface TerminalProps {
  sessionId: string;
  onClose?: () => void;
  syncSize?: boolean;
  preferredMode?: 'auto' | 'attach' | 'resize-client' | 'mirror' | 'readonly-mirror';
  height?: number;
}

type TerminalStatus = 'idle' | 'connecting' | 'ready' | 'error' | 'disconnected';

export default function Terminal({ sessionId, onClose, preferredMode = 'auto', height = 450 }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalBodyRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const readOnlyRef = useRef(false);
  const [isAltMode, setIsAltMode] = useState(false);
  const [status, setStatus] = useState<TerminalStatus>('idle');
  const [statusText, setStatusText] = useState('未接続');
  const [terminalSize, setTerminalSize] = useState({ cols: 0, rows: 0 });
  const [scrollLine, setScrollLine] = useState(1);
  const [clockText, setClockText] = useState('');
  const [readOnly, setReadOnly] = useState(false);

  useEffect(() => {
    if (!containerRef.current || !terminalRef.current || !terminalBodyRef.current) {
      return;
    }

    let mounted = true;
    let resizeObserver: ResizeObserver | null = null;
    let wheelCleanup: (() => void) | null = null;
    let bufferDisposable: { dispose: () => void } | null = null;
    let clockTimer: number | null = null;

    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 15,
      fontFamily: '"Iosevka Term", "SFMono-Regular", Consolas, monospace',
      lineHeight: 1.2,
      scrollback: 10000,
      convertEol: true,
      allowProposedApi: true,
      theme: {
        background: '#08111f',
        foreground: '#d7e3f4',
        cursor: '#7ce0c3',
        selectionBackground: 'rgba(124, 224, 195, 0.25)',
        black: '#102235',
        red: '#ff7b72',
        green: '#7ce0c3',
        yellow: '#e6c66b',
        blue: '#74b9ff',
        magenta: '#ff9ff3',
        cyan: '#68e1fd',
        white: '#d7e3f4',
        brightBlack: '#4e647d',
        brightRed: '#ff9b93',
        brightGreen: '#9cf0d0',
        brightYellow: '#f5d98d',
        brightBlue: '#9ecbff',
        brightMagenta: '#ffc4f8',
        brightCyan: '#9decff',
        brightWhite: '#ffffff',
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    const writeMeta = (message: string) => {
      term.writeln(`\r\n\x1b[90m[work-os] ${message}\x1b[0m`);
    };

    const updateAltMode = () => {
      setIsAltMode(term.buffer.active.type === 'alternate');
    };

    const updateMetrics = () => {
      setTerminalSize({ cols: term.cols, rows: term.rows });
      setScrollLine(term.buffer.active.viewportY + 1);
    };

    const mount = () => {
      if (!mounted || !terminalRef.current) {
        return;
      }
      if (terminalRef.current.clientWidth < 10) {
        window.setTimeout(mount, 80);
        return;
      }

      term.open(terminalRef.current);
      try {
        fitAddon.fit();
      } catch {
      }
      term.focus();
      updateAltMode();
      updateMetrics();

      bufferDisposable = term.buffer.onBufferChange(() => {
        updateAltMode();
        updateMetrics();
      });

      const socket = io({ path: '/socket.io', reconnectionAttempts: 5 });
      socketRef.current = socket;

      setStatus('connecting');
      setStatusText('接続中');
      writeMeta(`session ${sessionId} へ接続しています`);

      socket.on('connect', () => {
        if (!mounted) {
          return;
        }
        setStatus('connecting');
        setStatusText('tmux 接続中');
        socket.emit('start', {
          sessionId,
          cols: term.cols,
          rows: term.rows,
          preferredMode,
        });
      });

      socket.on('terminal:status', (payload: { state?: string; sessionId?: string; message?: string; readOnly?: boolean }) => {
        if (!mounted) {
          return;
        }
        const nextReadOnly = Boolean(payload?.readOnly);
        readOnlyRef.current = nextReadOnly;
        setReadOnly(nextReadOnly);
        if (payload?.state === 'ready') {
          setStatus('ready');
          setStatusText(payload.message || `LIVE: ${payload?.sessionId || sessionId}`);
          return;
        }
        if (payload?.state === 'connected') {
          setStatus('connecting');
          setStatusText(payload.message || 'socket 接続済み');
        }
      });

      socket.on('output', (data: string) => {
        if (!mounted) {
          return;
        }
        term.write(data);
      });

      socket.on('terminal:snapshot', (payload: { data?: string }) => {
        if (!mounted) {
          return;
        }
        term.reset();
        term.write(payload?.data || '');
      });

      socket.on('terminal:error', (payload: { message?: string }) => {
        if (!mounted) {
          return;
        }
        setStatus('error');
        setStatusText('エラー');
        writeMeta(payload?.message || 'terminal error');
      });

      socket.on('session-exit', (payload: { exitCode?: number; signal?: number }) => {
        if (!mounted) {
          return;
        }
        setStatus('disconnected');
        setStatusText('session 終了');
        writeMeta(`session ended code=${payload?.exitCode ?? 'n/a'} signal=${payload?.signal ?? 'n/a'}`);
      });

      socket.on('disconnect', () => {
        if (!mounted) {
          return;
        }
        setStatus('disconnected');
        setStatusText('切断');
      });

      socket.on('connect_error', (error) => {
        if (!mounted) {
          return;
        }
        setStatus('error');
        setStatusText('接続失敗');
        writeMeta(error.message);
      });

      term.onData((data) => {
        if (readOnlyRef.current) {
          return;
        }
        if (socket.connected) {
          socket.emit('command', { data });
        }
      });

      term.onResize(({ cols, rows }) => {
        setTerminalSize({ cols, rows });
      });

      term.onScroll((viewportY) => {
        setScrollLine(viewportY + 1);
      });

      term.onCursorMove(() => {
        setScrollLine(term.buffer.active.viewportY + term.buffer.active.cursorY + 1);
      });

      resizeObserver = new ResizeObserver(() => {
        window.requestAnimationFrame(() => {
          try {
            fitAddon.fit();
            updateMetrics();
            if (socket.connected) {
              socket.emit('resize', {
                cols: term.cols,
                rows: term.rows,
              });
            }
          } catch {
          }
        });
      });
      resizeObserver.observe(terminalRef.current as HTMLDivElement);

      const onWheel = (event: WheelEvent) => {
        if (term.buffer.active.type === 'alternate') {
          event.preventDefault();
        }
      };
      containerRef.current?.addEventListener('wheel', onWheel, { passive: false });
      wheelCleanup = () => containerRef.current?.removeEventListener('wheel', onWheel);

      const tickClock = () => {
        setClockText(
          new Intl.DateTimeFormat('ja-JP', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          }).format(new Date()),
        );
      };
      tickClock();
      clockTimer = window.setInterval(tickClock, 1000);
    };

    mount();

    return () => {
      mounted = false;
      resizeObserver?.disconnect();
      wheelCleanup?.();
      bufferDisposable?.dispose();
      if (clockTimer !== null) {
        window.clearInterval(clockTimer);
      }
      socketRef.current?.disconnect();
      fitAddonRef.current = null;
      xtermRef.current?.dispose();
      xtermRef.current = null;
      socketRef.current = null;
    };
  }, [sessionId, preferredMode]);

  const borderColor = status === 'error' ? 'rgba(255, 123, 114, 0.55)' : 'rgba(255, 255, 255, 0.08)';
  const toolbarBackground = isAltMode ? 'rgba(230, 198, 107, 0.16)' : 'rgba(255, 255, 255, 0.04)';
  const toolbarColor = isAltMode ? '#e6c66b' : '#93a4ba';
  const modeLabel = readOnly ? 'READ ONLY' : isAltMode ? 'APP MODE' : 'NORMAL MODE';

  return (
    <div
      ref={containerRef}
      className="workos-terminal-shell"
      style={{
        position: 'relative',
        width: '100%',
        height: `${height}px`,
        background: 'rgba(255, 255, 255, 0.05)',
        borderRadius: '22px',
        border: `1px solid ${borderColor}`,
        overflow: 'hidden',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 18px 60px rgba(8, 17, 31, 0.28)',
        backdropFilter: 'blur(14px)',
      }}
    >
      <div
        className="workos-terminal-toolbar"
        style={{
          padding: '12px 16px',
          fontSize: '13px',
          background: toolbarBackground,
          color: toolbarColor,
          fontWeight: 600,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        }}
      >
        <span>{modeLabel}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span>{statusText}</span>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              style={{
                background: 'transparent',
                color: '#d7e3f4',
                border: '1px solid rgba(255,255,255,0.18)',
                borderRadius: '999px',
                padding: '0.3rem 0.7rem',
                fontSize: '0.72rem',
                cursor: 'pointer',
              }}
            >
              Close
            </button>
          ) : null}
        </div>
      </div>

      <div
        className="workos-terminal-body"
        style={{
          width: '100%',
          flex: 1,
          minHeight: 0,
          boxSizing: 'border-box',
          background: 'linear-gradient(180deg, #091425 0%, #08111f 100%)',
        }}
      >
      <div
        ref={terminalBodyRef}
        className="workos-terminal-inner"
      >
        {readOnly ? (
          <div
            style={{
              position: 'absolute',
              top: '12px',
              right: '14px',
              zIndex: 5,
              padding: '0.25rem 0.55rem',
              borderRadius: '999px',
              border: '1px solid rgba(230,198,107,0.35)',
              background: 'rgba(230,198,107,0.14)',
              color: '#f5d98d',
              fontSize: '0.72rem',
              fontWeight: 700,
              letterSpacing: '0.04em',
            }}
          >
            INPUT DISABLED
          </div>
        ) : null}
        <div
          ref={terminalRef}
          className="workos-terminal-canvas"
        />
        </div>
      </div>

      <div
        className="workos-terminal-statusbar"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: '1rem',
          padding: '8px 16px 10px',
          borderTop: '1px solid rgba(255, 255, 255, 0.08)',
          background: 'rgba(255, 255, 255, 0.03)',
          color: '#7f93ab',
          fontSize: '12px',
          lineHeight: 1,
        }}
      >
        <span>{statusText}</span>
        <span>{terminalSize.cols} x {terminalSize.rows}</span>
        <span>line {scrollLine}</span>
        <span>{clockText}</span>
      </div>
    </div>
  );
}
