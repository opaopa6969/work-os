'use client';

import { useEffect, useState } from 'react';
import AnsiToHtml from 'ansi-to-html';
import dynamic from 'next/dynamic';

const Terminal = dynamic(() => import('@/components/Terminal'), { ssr: false });

const converter = new AnsiToHtml({
  fg: '#FFF',
  bg: '#000',
  newline: true,
  escapeXML: true,
  stream: false
});

interface Session {
  id: string;
  name: string;
  isAttached: boolean;
  isWaitingForInput?: boolean;
  lastLine?: string;
  content?: string;
}

const translations = {
  ja: {
    title: 'Work OS v0.2.0',
    richMode: 'リッチ表示 (色)',
    help: 'ヘルプ',
    commander: '司令塔: グローバル・ダッシュボード',
    showControls: '操作を表示',
    showPreview: 'プレビューを表示',
    previewLines: '行数',
    autoYes: '自動承認',
    launchAgent: 'エージェントを起動',
    sessionName: 'セッション名',
    command: 'コマンド (例: claude)',
    directory: 'ディレクトリ (パス)',
    launch: '起動',
    loading: 'セッションを読み込み中...',
    noSessions: '実行中のセッションはありません',
    backToDash: '↑ ダッシュボードへ戻る',
    howItWorks: '動作原理',
    usage: '使用方法',
    cliLaunch: 'CLI からの起動',
    principles: 'Work OS は Docker (監視) と ホスト (実行) のハイブリッド構成で動作します。ホストの tmux ソケットをマウントし、Cloudflare Tunnel を介して安全に外部公開されます。',
    usageGuide: '司令塔ビューで全エージェントを俯瞰し、入力待ち(⚡マーク)が発生したら即座に Y/N を送信できます。Auto-Yes をオンにすると、y/n の確認を自動で承諾します。',
    cliGuide: 'ホスト（WSL等）のターミナルから直接エージェントを開始できます：',
    cliCmd: 'tmux new -s セッション名 "コマンド"',
    cliNote: '例: tmux new -s my-agent "claude". これにより即座にダッシュボードに表示されます。',
    shellGuide: '🐚 Shell ボタン: そのセッションと同じディレクトリで新しいシェルを開始します。',
    sending: '📡 送信中...'
  },
  en: {
    title: 'Work OS v0.2.0',
    richMode: 'Rich UI (Color)',
    help: 'Help',
    commander: 'Commander: Global Dashboard',
    showControls: 'Show Controls',
    showPreview: 'Show Preview',
    previewLines: 'Lines',
    autoYes: 'Auto-Yes',
    launchAgent: 'Launch Custom Agent',
    sessionName: 'Session Name',
    command: 'Command (e.g. claude)',
    directory: 'Directory (Path)',
    launch: 'Launch',
    loading: 'Loading sessions...',
    noSessions: 'No active sessions found',
    backToDash: '↑ Back to Dashboard',
    howItWorks: 'Principles',
    usage: 'Usage',
    cliLaunch: 'CLI Integration',
    principles: 'Work OS uses a hybrid Docker (monitor) and Host (execute) architecture. It connects to host tmux via socket sharing and is securely exposed via Cloudflare Tunnel.',
    usageGuide: 'Monitor all agents in the Commander View. If an agent waits for input (⚡ mark), you can send Y/N immediately. Enable Auto-Yes to automatically accept y/n prompts.',
    cliGuide: 'You can start agents directly from your host terminal:',
    cliCmd: 'tmux new -s <session-name> "<command>"',
    cliNote: 'e.g., tmux new -s my-agent "claude". It will appear on the dashboard instantly.',
    shellGuide: '🐚 Shell button: Start a new shell session in the same directory as the agent.',
    sending: '📡 Sending...'
  }
};

export default function Home() {
  const [lang, setLang] = useState<'ja' | 'en'>('ja');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRichMode, setIsRichMode] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const [showDashControls, setShowDashControls] = useState(true);
  const [showDashPreview, setShowDashPreview] = useState(false);
  const [dashPreviewLines, setDashPreviewLines] = useState(1);
  const [autoYesMap, setAutoYesMap] = useState<Record<string, boolean>>({});
  const [activeShellMap, setActiveShellMap] = useState<Record<string, string>>({});
  const [newSession, setNewSession] = useState({ name: '', command: '', cwd: '' });
  const [customCommands, setCustomCommands] = useState<Record<string, string>>({});
  const [sendingStatus, setSendingStatus] = useState<Record<string, boolean>>({});

  const t = translations[lang];

  // 全セッションの一覧を取得
  const fetchSessions = async () => {
    try {
      const res = await fetch('/api/sessions');
      const data = await res.json();
      if (data.sessions) {
        const updatedSessions = await Promise.all(
          data.sessions.map(async (s: Session) => {
            try {
              const capRes = await fetch(`/api/sessions/${s.id}`);
              const capData = await capRes.json();
              
              // 自動承認ロジック
              if (autoYesMap[s.id] && capData.isWaitingForInput && !sendingStatus[s.id]) {
                sendKey(s.id, 'y Enter');
              }

              return { ...s, ...capData };
            } catch {
              return s;
            }
          })
        );
        setSessions(updatedSessions);
      }
    } catch (error) {
      console.error('Failed to fetch sessions', error);
    } finally {
      setLoading(false);
    }
  };

  const startSession = async (name: string, command: string, cwd?: string) => {
    if (!name || !command) return;
    try {
      await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, command, cwd }),
      });
      fetchSessions();
      setNewSession({ ...newSession, name: '' });
    } catch (error) {
      console.error('Failed to start session', error);
    }
  };

  const sendKey = async (id: string, key: string) => {
    if (sendingStatus[id]) return;
    setSendingStatus(prev => ({ ...prev, [id]: true }));
    
    try {
      await fetch(`/api/sessions/${id}/send-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      
      // 送信直後と、少し間を置いてからリフレッシュ（tmuxの描画ラグ対策）
      const refresh = async () => {
        const capRes = await fetch(`/api/sessions/${id}`);
        const capData = await capRes.json();
        setSessions(prev => prev.map(s => s.id === id ? { ...s, content: capData.content } : s));
      };
      
      await refresh();
      setTimeout(refresh, 200);
      setTimeout(refresh, 800);
    } catch (error) {
      console.error('Failed to send key', error);
    } finally {
      setSendingStatus(prev => ({ ...prev, [id]: false }));
    }
  };

  const killSession = async (id: string) => {
    if (!confirm(`Kill session ${id}?`)) return;
    try {
      await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
      // Shell マップからも削除
      setActiveShellMap(prev => {
        const next = { ...prev };
        Object.keys(next).forEach(key => {
          if (next[key] === id) delete next[key];
        });
        delete next[id];
        return next;
      });
      fetchSessions();
    } catch (error) {
      console.error('Failed to kill session', error);
    }
  };

  const enterShell = async (id: string) => {
    try {
      const res = await fetch(`/api/sessions/${id}/shell`, { method: 'POST' });
      const data = await res.json();
      if (data.newSession) {
        setActiveShellMap(prev => ({ ...prev, [id]: data.newSession }));
      }
      fetchSessions();
    } catch (error) {
      console.error('Failed to open shell', error);
    }
  };

  useEffect(() => {
    fetchSessions();
    const interval = setInterval(fetchSessions, 2000); // 2秒おきに更新
    return () => clearInterval(interval);
  }, []);

  return (
    <main>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1 style={{ margin: 0 }}>{t.title}</h1>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <button 
            onClick={() => setLang(lang === 'ja' ? 'en' : 'ja')}
            style={{ background: '#333', fontSize: '0.75rem', padding: '0.4rem 0.8rem', borderRadius: '4px', border: '1px solid #444', color: '#fff', cursor: 'pointer' }}
          >
            {lang === 'ja' ? 'EN' : '日本語'}
          </button>
          <button 
            onClick={() => setShowHelp(!showHelp)}
            style={{ background: showHelp ? 'var(--accent)' : '#333', color: showHelp ? '#000' : '#fff', fontSize: '0.75rem', padding: '0.4rem 0.8rem', borderRadius: '4px', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}
          >
            {t.help}
          </button>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', cursor: 'pointer', color: '#888' }}>
            <input 
              type="checkbox" 
              checked={isRichMode} 
              onChange={(e) => setIsRichMode(e.target.checked)}
            />
            {t.richMode}
          </label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={() => startSession(`claude-${Date.now().toString().slice(-4)}`, 'claude', newSession.cwd)}>+ Claude</button>
            <button onClick={() => startSession(`gemini-${Date.now().toString().slice(-4)}`, 'gemini', newSession.cwd)}>+ Gemini</button>
          </div>
        </div>
      </header>

      {showHelp && (
        <section style={{ marginBottom: '2rem', padding: '1rem', background: '#1a1a2e', borderRadius: '8px', border: '1px solid #3f3f5f', fontSize: '0.9rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem' }}>
            <div>
              <h3 style={{ color: 'var(--accent)', marginTop: 0 }}>{t.howItWorks}</h3>
              <p style={{ color: '#ccc', lineHeight: '1.4', margin: 0 }}>{t.principles}</p>
            </div>
            <div>
              <h3 style={{ color: 'var(--accent)', marginTop: 0 }}>{t.usage}</h3>
              <p style={{ color: '#ccc', lineHeight: '1.4', margin: 0 }}>{t.usageGuide}</p>
              <p style={{ color: '#aaa', fontSize: '0.8rem', marginTop: '0.5rem' }}>{t.shellGuide}</p>
            </div>
            <div>
              <h3 style={{ color: 'var(--accent)', marginTop: 0 }}>{t.cliLaunch}</h3>
              <p style={{ color: '#ccc', marginBottom: '0.5rem', margin: 0 }}>{t.cliGuide}</p>
              <code style={{ display: 'block', background: '#000', padding: '0.5rem', borderRadius: '4px', fontSize: '0.8rem', margin: '0.5rem 0' }}>{t.cliCmd}</code>
              <p style={{ fontSize: '0.75rem', color: '#888', marginTop: '0.5rem', margin: 0 }}>{t.cliNote}</p>
            </div>
          </div>
        </section>
      )}

      {/* 司令塔ビュー: 全セッションの状態一括表示 */}
      <section style={{ marginBottom: '2rem', background: '#111', padding: '1rem', borderRadius: '8px', border: '1px solid var(--accent)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '0.9rem', margin: 0, color: 'var(--accent)' }}>{t.commander}</h2>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', fontSize: '0.75rem', color: '#888' }}>
            <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <input type="checkbox" checked={showDashControls} onChange={(e) => setShowDashControls(e.target.checked)} /> {t.showControls}
            </label>
            <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <input type="checkbox" checked={showDashPreview} onChange={(e) => setShowDashPreview(e.target.checked)} /> {t.showPreview}
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              {t.previewLines}: 
              <input 
                type="number" 
                value={dashPreviewLines} 
                onChange={(e) => setDashPreviewLines(parseInt(e.target.value) || 1)}
                style={{ width: '40px', background: '#000', color: '#fff', border: '1px solid #333', textAlign: 'center' }}
              />
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {sessions.map(s => (
            <div key={s.id} id={`row-${s.id}`} style={{ 
              display: 'flex', 
              flexDirection: 'column',
              gap: '0.5rem', 
              padding: '0.5rem', 
              background: s.isWaitingForInput ? '#2a2a00' : 'transparent',
              borderBottom: '1px solid #222'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', fontSize: '0.85rem' }}>
                <a href={`#card-${s.id}`} style={{ color: s.isWaitingForInput ? '#ffeb3b' : '#fff', fontWeight: 'bold', width: '120px', textDecoration: 'none' }}>
                  {s.isWaitingForInput ? '⚡ ' : ''}{s.name}
                </a>
                <span style={{ width: '80px', color: s.isAttached ? '#00ff88' : '#555' }}>
                  {s.isAttached ? '● active' : '○ idle'}
                </span>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem', color: '#888', width: '100px' }}>
                  <input 
                    type="checkbox" 
                    checked={autoYesMap[s.id] || false}
                    onChange={(e) => setAutoYesMap({ ...autoYesMap, [s.id]: e.target.checked })}
                  />
                  {t.autoYes}
                </label>
                
                {showDashControls && (
                  <div style={{ flex: 1, display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
                    <button onClick={() => sendKey(s.id, 'Up')}>↑</button>
                    <button onClick={() => sendKey(s.id, 'Down')}>↓</button>
                    <button onClick={() => sendKey(s.id, 'y')} style={{ background: '#2d4a3e', color: '#00ff88' }}>y</button>
                    <button onClick={() => sendKey(s.id, 'n')} style={{ background: '#4a2d2d', color: '#ff8888' }}>n</button>
                    <input 
                      type="text" 
                      placeholder="cmd..." 
                      value={customCommands[s.id] || ''}
                      onChange={(e) => setCustomCommands({ ...customCommands, [s.id]: e.target.value })}
                      onKeyDown={(e) => e.key === 'Enter' && (sendKey(s.id, customCommands[s.id] + ' Enter'), setCustomCommands({ ...customCommands, [s.id]: '' }))}
                      style={{ background: '#000', color: '#fff', border: '1px solid #333', padding: '0.2rem', borderRadius: '4px', width: '80px' }}
                    />
                    <button onClick={() => sendKey(s.id, 'Enter')}>↵</button>
                  </div>
                )}
              </div>

              {showDashPreview && (
                <div style={{ 
                  fontSize: '0.75rem', 
                  fontFamily: 'monospace', 
                  background: '#000', 
                  padding: '0.4rem', 
                  borderRadius: '4px', 
                  border: '1px solid #222',
                  overflow: 'hidden',
                  maxHeight: '100px',
                  color: s.isWaitingForInput ? '#ffeb3b' : '#ccc'
                }}>
                  {isRichMode ? (
                    <div dangerouslySetInnerHTML={{ 
                      __html: converter.toHtml((s.content || '').split('\n').slice(-dashPreviewLines).join('\n')) 
                    }} />
                  ) : (
                    <pre style={{ margin: 0 }}>{(s.content || '').split('\n').slice(-dashPreviewLines).join('\n')}</pre>
                  )}
                </div>
              )}
            </div>
          ))}
          {sessions.length === 0 && <p style={{ fontSize: '0.8rem', color: '#555' }}>{t.noSessions}</p>}
        </div>
      </section>

      <section style={{ marginBottom: '2rem', background: 'var(--card-bg)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--card-border)' }}>
        <h2 style={{ fontSize: '1rem', marginBottom: '1rem', color: 'var(--text-dim)' }}>{t.launchAgent}</h2>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <input 
            type="text" 
            placeholder={t.sessionName} 
            value={newSession.name}
            onChange={(e) => setNewSession({ ...newSession, name: e.target.value })}
            style={{ background: '#000', color: '#fff', border: '1px solid #333', padding: '0.5rem', borderRadius: '4px', flex: 1, minWidth: '150px' }}
          />
          <input 
            type="text" 
            placeholder={t.command} 
            value={newSession.command}
            onChange={(e) => setNewSession({ ...newSession, command: e.target.value })}
            style={{ background: '#000', color: '#fff', border: '1px solid #333', padding: '0.5rem', borderRadius: '4px', flex: 2, minWidth: '200px' }}
          />
          <input 
            type="text" 
            placeholder={t.directory} 
            value={newSession.cwd}
            onChange={(e) => setNewSession({ ...newSession, cwd: e.target.value })}
            style={{ background: '#000', color: '#fff', border: '1px solid #333', padding: '0.5rem', borderRadius: '4px', flex: 2, minWidth: '200px' }}
          />
          <button onClick={() => startSession(newSession.name, newSession.command, newSession.cwd)}>{t.launch}</button>
        </div>
        <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem' }}>
          <button 
            onClick={() => setNewSession({ ...newSession, cwd: '/mnt/c/var/work/work-os' })}
            style={{ background: 'transparent', border: '1px solid #444', color: '#888', fontSize: '0.7rem' }}
          >
            📍 work-os
          </button>
        </div>
      </section>
      
      {loading && sessions.length === 0 ? (
        <p>{t.loading}</p>
      ) : (
        <div className="session-grid">
          {sessions.map((session) => {
            const isShell = session.name.startsWith('sh-');
            
            return (
              <div key={session.id} id={`card-${session.id}`} className="session-card" style={{ 
                opacity: sendingStatus[session.id] ? 0.7 : 1, 
                transition: 'opacity 0.2s',
                border: session.isWaitingForInput ? '1px solid #ffeb3b' : '1px solid var(--card-border)',
                marginBottom: isShell ? '2rem' : '0.5rem'
              }}>
                <div className="session-header">
                  <span className="session-name">
                    {isShell ? '🐚 ' : ''}{session.name}
                    {session.isWaitingForInput && <span style={{ marginLeft: '10px', fontSize: '0.7rem', color: '#ffeb3b' }}>⚡ INPUT WAITING</span>}
                    {sendingStatus[session.id] && <span style={{ marginLeft: '10px', fontSize: '0.7rem', color: 'var(--accent)' }}>{t.sending}</span>}
                  </span>
                  <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    {!isShell && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.7rem', color: '#888', cursor: 'pointer' }}>
                        <input 
                          type="checkbox" 
                          checked={autoYesMap[session.id] || false}
                          onChange={(e) => setAutoYesMap({ ...autoYesMap, [session.id]: e.target.checked })}
                        />
                        {t.autoYes}
                      </label>
                    )}
                    <span className={`session-status ${session.isAttached ? 'status-active' : ''}`}>
                      {session.isAttached ? 'Attached' : 'Idle'}
                    </span>
                  </div>
                </div>
                
                {/* Shell session はプレビューを隠してインタラクティブ端末を優先する */}
                {(!isShell || !activeShellMap[session.id]) && (
                  isRichMode ? (
                    <div 
                      className="session-preview" 
                      dangerouslySetInnerHTML={{ __html: converter.toHtml(session.content || 'No output captured yet...') }}
                    />
                  ) : (
                    <pre className="session-preview">
                      {session.content || 'No output captured yet...'}
                    </pre>
                  )
                )}

                {activeShellMap[session.id] && (
                  <div style={{ marginTop: '1rem' }}>
                    <Terminal 
                      sessionId={activeShellMap[session.id]} 
                      onClose={() => setActiveShellMap(prev => {
                        const next = { ...prev };
                        delete next[session.id];
                        return next;
                      })} 
                    />
                  </div>
                )}

                <div className="session-footer" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
                  {!isShell ? (
                    <>
                      <div style={{ display: 'flex', gap: '0.4rem' }}>
                        <input 
                          type="text" 
                          placeholder="Send command..." 
                          value={customCommands[session.id] || ''}
                          onChange={(e) => setCustomCommands({ ...customCommands, [session.id]: e.target.value })}
                          onKeyDown={(e) => e.key === 'Enter' && (sendKey(session.id, customCommands[session.id] + ' Enter'), setCustomCommands({ ...customCommands, [session.id]: '' }))}
                          style={{ background: '#000', color: '#fff', border: '1px solid #333', padding: '0.3rem', borderRadius: '4px', flex: 1, fontSize: '0.8rem' }}
                        />
                        <button onClick={() => { sendKey(session.id, customCommands[session.id] + ' Enter'); setCustomCommands({ ...customCommands, [session.id]: '' }); }} style={{ background: '#333', color: '#fff' }}>Send</button>
                      </div>
                      
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                          <button onClick={() => sendKey(session.id, 'Up')}>↑</button>
                          <button onClick={() => sendKey(session.id, 'Down')}>↓</button>
                          <button onClick={() => sendKey(session.id, 'y')} style={{ background: '#2d4a3e', color: '#00ff88' }}>y</button>
                          <button onClick={() => sendKey(session.id, 'n')} style={{ background: '#4a2d2d', color: '#ff8888' }}>n</button>
                          <button onClick={() => sendKey(session.id, 'Enter')}>↵</button>
                        </div>
                        <div style={{ display: 'flex', gap: '0.4rem' }}>
                          <button onClick={() => window.open(`/api/sessions/${session.id}`, '_blank')} style={{ background: 'transparent', color: 'var(--text-dim)', border: '1px solid #333', fontSize: '0.7rem' }}>
                            Raw
                          </button>
                          <button onClick={() => enterShell(session.id)} style={{ background: 'transparent', color: 'var(--accent)', border: '1px solid #2d4a4a', fontSize: '0.7rem' }}>
                            🐚 Shell
                          </button>
                          <button onClick={() => killSession(session.id)} style={{ background: 'transparent', color: '#ff4444', border: '1px solid #442222', fontSize: '0.7rem' }}>
                            Kill
                          </button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button onClick={() => killSession(session.id)} style={{ background: 'transparent', color: '#ff4444', border: '1px solid #442222', fontSize: '0.7rem' }}>
                        Kill Shell Session
                      </button>
                    </div>
                  )}
                  <div style={{ marginTop: '0.5rem', display: 'flex', justifyContent: 'center' }}>
                    <a href={`#row-${session.id}`} style={{ fontSize: '0.7rem', color: 'var(--accent)', textDecoration: 'none' }}>{t.backToDash}</a>
                  </div>
                </div>
              </div>
            );
          })}
          {sessions.length === 0 && <p>{t.noSessions}</p>}
        </div>
      )}
    </main>
  );
}
