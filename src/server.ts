import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import next from 'next';
import { execSync, spawnSync } from 'child_process';

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

// 未捕捉の例外をキャッチしてプロセスを維持
process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Server] Unhandled Rejection at:', promise, 'reason:', reason);
});

// TMUX_SOCKET が指定されている場合は -S オプションを付与する
const TMUX_SOCKET = process.env.TMUX_SOCKET || '';
const getTmuxArgs = (args: string[]) => TMUX_SOCKET ? ['-S', TMUX_SOCKET, ...args] : args;
const getTmuxCmd = (cmd: string) => TMUX_SOCKET ? `tmux -S ${TMUX_SOCKET} ${cmd}` : `tmux ${cmd}`;

// セッションごとの最新サイズを保持
const sessionDimensions = new Map<string, { cols: number, rows: number }>();

app.prepare().then(() => {
  const server = express();
  const httpServer = createServer(server);
  const io = new Server(httpServer, {
    path: '/socket.io'
  });

  io.on('connection', (socket) => {
    console.log(`[Socket] Client connected: ${socket.id}`);

    let refreshInterval: NodeJS.Timeout | null = null;

    socket.on('start', ({ sessionId, cols, rows, syncSize }) => {
      console.log(`[Socket] Starting Bridge for session: ${sessionId} (${cols}x${rows}, sync: ${syncSize})`);
      
      // マウスモードを有効化 (スクロールやペイン選択を可能にする)
      try {
        spawnSync('tmux', getTmuxArgs(['set-option', '-t', sessionId, 'mouse', 'on']));
      } catch (e) {}

      if (cols && rows) {
        sessionDimensions.set(sessionId, { cols, rows });
        
        // syncSize が true の場合、ホスト側の tmux pane サイズを Web 側に合わせる
        if (syncSize) {
          try {
            spawnSync('tmux', getTmuxArgs(['resize-pane', '-t', sessionId, '-x', cols.toString(), '-y', rows.toString()]));
          } catch (e) {}
        }
      }

      const refresh = () => {
        try {
          const dimensions = sessionDimensions.get(sessionId);
          if (dimensions) {
            spawnSync('tmux', getTmuxArgs(['resize-pane', '-t', sessionId, '-x', dimensions.cols.toString(), '-y', dimensions.rows.toString()]));
          }

          // -J フラグを外し、-e (エスケープ維持) のみで行う。末尾の空白行をトリミング。
          const output = execSync(getTmuxCmd(`capture-pane -pe -t "${sessionId}"`), { 
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'ignore'] 
          }).replace(/\s+$/, ''); // 末尾の空白・改行を削除

          const cursorInfo = execSync(getTmuxCmd(`display-message -p -t "${sessionId}" "#{pane_cursor_x},#{pane_cursor_y}"`), {
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'ignore']
          }).trim();

          let [cx, cy] = cursorInfo.split(',').map(Number);
          const normalizedOutput = output.replace(/\n/g, '\r\n');
          
          // カーソル座標が画面内に収まるように調整
          if (dimensions) {
            cx = Math.min(cx, dimensions.cols - 1);
            cy = Math.min(cy, dimensions.rows - 1);
          }

          // 1. 画面消去とホーム移動
          // 2. 画面内容の描画
          // 3. カーソル表示 (\x1b[?25h)
          // 4. 指定座標への移動 (\x1b[cy+1;cx+1H)
          // これを一気に送ることでカーソルを固定する
          const finalOutput = `\x1b[H\x1b[2J${normalizedOutput}\x1b[?25h\x1b[${cy + 1};${cx + 1}H`;
          socket.emit('output', finalOutput);
        } catch (e) {

          if (refreshInterval) clearInterval(refreshInterval);
        }
      };

      refresh();
      refreshInterval = setInterval(refresh, 250); 
    });

    socket.on('command', ({ sessionId, data }) => {
      try {
        const keyMap: Record<string, string> = {
          '\x1b[A': 'Up', '\x1b[B': 'Down', '\x1b[C': 'Right', '\x1b[D': 'Left',
          '\x1b[5~': 'PageUp', '\x1b[6~': 'PageDown', '\x1b[H': 'Home', '\x1b[F': 'End',
          '\x1b[3~': 'DC', '\x0d': 'Enter', '\x7f': 'BSpace',
          'WHEEL_UP': 'PageUp', 'WHEEL_DOWN': 'PageDown',
        };
        if (keyMap[data]) {
          spawnSync('tmux', getTmuxArgs(['send-keys', '-t', sessionId, keyMap[data]]));
        } else {
          spawnSync('tmux', getTmuxArgs(['send-keys', '-t', sessionId, '-l', data]));
        }
      } catch (e) {
        console.error(`[Socket] Command error:`, e);
      }
    });

    socket.on('resize', ({ sessionId, cols, rows }) => {
      try {
        sessionDimensions.set(sessionId, { cols, rows });
        spawnSync('tmux', getTmuxArgs(['resize-pane', '-t', sessionId, '-x', cols.toString(), '-y', rows.toString()]));
      } catch (e) {
        console.error(`[Socket] Resize error:`, e);
      }
    });

    socket.on('disconnect', () => {
      console.log(`[Socket] Client disconnected: ${socket.id}`);
      if (refreshInterval) clearInterval(refreshInterval);
    });
  });

  server.all('*all', (req, res) => {
    return handle(req, res);
  });

  const PORT = Number(process.env.PORT) || 4000;
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`> Ready on http://0.0.0.0:${PORT}`);
  });
}).catch(err => {
  console.error('>>> [Server] Fatal Error during Next.js prepare:', err);
  process.exit(1);
});
