'use client';

import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { io, Socket } from 'socket.io-client';
import 'xterm/css/xterm.css';

interface TerminalProps {
  sessionId: string;
  onClose?: () => void;
}

export default function Terminal({ sessionId, onClose }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    // xterm の初期化
    const term = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      theme: {
        background: '#000000',
      },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    fitAddon.fit();
    xtermRef.current = term;

    // Socket.io の初期化
    const socket = io();
    socketRef.current = socket;

    socket.on('connect', () => {
      term.write('\r\n\x1b[32mCONNECTED TO WORK OS TERMINAL\x1b[0m\r\n');
      socket.emit('start', { sessionId });
    });

    socket.on('output', (data: string) => {
      term.write(data);
    });

    term.onData((data) => {
      socket.emit('input', data);
    });

    const handleResize = () => {
      fitAddon.fit();
      socket.emit('resize', { cols: term.cols, rows: term.rows });
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      socket.disconnect();
      term.dispose();
    };
  }, [sessionId]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '400px', background: '#000', padding: '10px', borderRadius: '4px', border: '1px solid #333' }}>
      <button 
        onClick={onClose}
        style={{ 
          position: 'absolute', 
          top: '5px', 
          right: '5px', 
          zIndex: 10, 
          background: '#ff4444', 
          color: '#fff', 
          border: 'none', 
          borderRadius: '4px', 
          padding: '2px 8px',
          cursor: 'pointer',
          fontSize: '0.7rem'
        }}
      >
        Close Shell
      </button>
      <div ref={terminalRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
