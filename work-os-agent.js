#!/usr/bin/env node
/**
 * Work-OS Agent - REST API server for tmux session management
 */

const http = require('http');
const { execSync } = require('child_process');

const PORT = process.env.AGENT_PORT || 3001;
const TMUX_SOCKET = process.env.TMUX_SOCKET || '/tmp/tmux-1000/default';

function getTmuxSessions() {
  try {
    const output = execSync(`tmux -S "${TMUX_SOCKET}" ls -F '#{session_name}|#{session_created}|#{session_attached}|#{pane_current_command}|#{pane_current_path}' 2>/dev/null`, {
      encoding: 'utf-8',
      timeout: 5000
    }).trim();

    if (!output) return [];

    return output.split('\n').map(line => {
      const [name, created, attached, command, path] = line.split('|');
      return {
        name,
        created: parseInt(created),
        isAttached: attached === '1',
        currentCommand: command || '',
        currentPath: path || ''
      };
    });
  } catch (error) {
    return [];
  }
}

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.url === '/api/sessions' && req.method === 'GET') {
    const sessions = getTmuxSessions();
    res.writeHead(200);
    res.end(JSON.stringify({ sessions }, null, 2));
  } else if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok' }));
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[work-os-agent] listening on 0.0.0.0:${PORT}`);
});

process.on('SIGTERM', () => {
  console.log('[work-os-agent] shutting down');
  server.close(() => process.exit(0));
});
