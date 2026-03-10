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
}

export default function Terminal({ sessionId, onClose, syncSize = true }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [isAltMode, setIsAltMode] = useState(false);
  const isScrolling = useRef(false);
  const scrollTimeout = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    let isComponentMounted = true;
    if (!terminalRef.current || !containerRef.current) return;

    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: 'block',
      cursorInactiveStyle: 'block', // フォーカス外でもブロック表示
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      theme: { 
        background: '#000000', 
        cursor: '#00ff88',
        selectionBackground: 'rgba(0, 255, 136, 0.3)'
      },
      scrollback: 5000,
      convertEol: true,
      allowProposedApi: true
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    fitAddonRef.current = fitAddon;
    
    const init = () => {
      if (!isComponentMounted || !terminalRef.current) return;
      if (terminalRef.current.clientWidth < 10) {
        setTimeout(init, 100);
        return;
      }

      term.open(terminalRef.current);
      xtermRef.current = term;
      
      try {
        fitAddon.fit();
        term.focus();
      } catch (e) {}

      term.buffer.onBufferChange(() => {
        setIsAltMode(term.buffer.active.type === 'alternate');
      });

      const socket = io({ path: '/socket.io', reconnectionAttempts: 5 });
      socketRef.current = socket;

      socket.on('connect', () => {
        if (isComponentMounted) {
          socket.emit('start', { sessionId, cols: term.cols, rows: term.rows, syncSize });
        }
      });

      socket.on('output', (data: string) => {
        if (isComponentMounted && xtermRef.current && !isScrolling.current) {
          // 1. 描画
          term.write(data);
          // 2. カーソルを強制的に可視化するエスケープシーケンスを再度叩き込む
          term.write('\x1b[?25h');
          // 3. 画面の強制リフレッシュ
          term.refresh(0, term.rows - 1);
        }
      });

      term.onData((data) => {
        if (socket.connected) {
          socket.emit('command', { sessionId, data });
        }
      });
    };

    init();

    const handleWheel = (e: WheelEvent) => {
      if (!xtermRef.current || !socketRef.current?.connected) return;
      if (isAltMode) {
        e.preventDefault();
        const cmd = e.deltaY > 0 ? 'WHEEL_DOWN' : 'WHEEL_UP';
        socketRef.current.emit('command', { sessionId, data: cmd });
      } else {
        isScrolling.current = true;
        if (scrollTimeout.current) clearTimeout(scrollTimeout.current);
        scrollTimeout.current = setTimeout(() => {
          isScrolling.current = false;
        }, 1500); 
      }
    };

    const container = containerRef.current;
    container.addEventListener('wheel', handleWheel, { passive: false });

    // クリック時にフォーカスを強制
    const handleClick = () => {
      if (xtermRef.current) term.focus();
    };
    container.addEventListener('click', handleClick);

    return () => {
      isComponentMounted = false;
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('click', handleClick);
      if (scrollTimeout.current) clearTimeout(scrollTimeout.current);
      if (socketRef.current) socketRef.current.disconnect();
      if (xtermRef.current) term.dispose();
      xtermRef.current = null;
    };
  }, [sessionId]);

  return (
    <div 
      ref={containerRef}
      style={{ 
        position: 'relative', width: '100%', height: '450px', 
        background: '#000', borderRadius: '4px', 
        border: `1px solid ${isAltMode ? '#00d1b2' : '#333'}`,
        overflow: 'hidden', boxSizing: 'border-box',
        display: 'flex', flexDirection: 'column'
      }}
    >
      <div style={{
        padding: '4px 10px', fontSize: '0.7rem',
        background: isAltMode ? '#00d1b2' : '#222', color: isAltMode ? '#000' : '#888',
        fontWeight: 'bold', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        borderBottom: '1px solid #333'
      }}>
        <span>{isAltMode ? 'APP MODE' : 'SHELL MODE'}</span>
        <span>
          Sync: {syncSize ? 'ON' : 'OFF'} | Scroll: {isAltMode ? 'App' : 'History'}
        </span>
      </div>

      <div 
        ref={terminalRef} 
        style={{ 
          width: '100%', 
          height: 'calc(100% - 25px)',
          padding: '10px',
          boxSizing: 'border-box'
        }} 
      />
    </div>
  );
}
