import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import next from 'next';
import * as pty from 'node-pty';

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

const SOCKET_PATH = '/tmp/tmux-1000/default';

app.prepare().then(() => {
  const server = express();
  const httpServer = createServer(server);
  const io = new Server(httpServer);

  // WebSocket 接続のハンドリング
  io.on('connection', (socket) => {
    console.log('Client connected to terminal socket');

    let ptyProcess: pty.IPty | null = null;

    socket.on('start', ({ sessionId }) => {
      console.log(`Starting PTY for session: ${sessionId}`);
      
      // tmux セッションにアタッチする PTY を作成
      ptyProcess = pty.spawn('tmux', ['-S', SOCKET_PATH, 'attach', '-t', sessionId], {
        name: 'xterm-color',
        cols: 80,
        rows: 24,
        cwd: process.env.HOME,
        env: process.env as any,
      });

      // PTY の出力を WebSocket でクライアントに送る
      ptyProcess.onData((data) => {
        socket.emit('output', data);
      });

      ptyProcess.onExit(({ exitCode, signal }) => {
        console.log(`PTY exited with code ${exitCode}`);
        socket.disconnect();
      });
    });

    // クライアントからの入力を PTY に送る
    socket.on('input', (data) => {
      if (ptyProcess) {
        ptyProcess.write(data);
      }
    });

    // リサイズ命令のハンドリング
    socket.on('resize', ({ cols, rows }) => {
      if (ptyProcess) {
        ptyProcess.resize(cols, rows);
      }
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected');
      if (ptyProcess) {
        ptyProcess.kill();
      }
    });
  });

  // その他のリクエストはすべて Next.js に任せる
  server.all('*', (req, res) => {
    return handle(req, res);
  });

  const PORT = process.env.PORT || 3000;
  httpServer.listen(PORT, () => {
    console.log(`> Ready on http://localhost:${PORT}`);
  });
});
