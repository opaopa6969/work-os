'use client';

import { useEffect, useState, useRef } from 'react';
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
  lastActivity?: number;
  command?: string;
  directory?: string;
  currentCommand?: string;
  currentPath?: string;
  clientCount?: number;
  suggestedMode?: 'attach' | 'mirror';
  isWaitingForInput?: boolean;
  lastLine?: string;
  content?: string;
  summary?: string;
}

interface Template {
  name: string;
  description: string;
}

const translations = {
  ja: {
    title: 'Work OS v0.8.8',
    richMode: 'リッチ表示 (色)',
    help: 'ヘルプ',
    commander: '司令塔: 全セッション監視',
    showPreview: 'プレビューを表示',
    previewLines: '行数',
    autoYes: '自動承認',
    summary: '要約',
    orchestration: '連携モード',
    proxySelect: '相談役を選択',
    noProxy: '相談役なし',
    launchAgent: 'エージェントを起動 (性格を選択)',
    sessionName: 'セッション名',
    command: 'コマンド (例: claude)',
    directory: 'ディレクトリ (パス)',
    template: '性格 (テンプレート)',
    noTemplate: '性格未設定',
    installPersonality: 'エージェントの性格をインストール:',
    duplicate: 'この性格を複製',
    launch: '起動',
    loading: '読み込み中...',
    noSessions: '実行中のセッションはありません',
    backToDash: '↑ 司令塔へ戻る',
    howItWorks: '動作原理',
    usage: '使用方法',
    personalityGuide: '性格ガイド',
    principles: 'Work OS は Docker (監視) と ホスト (実行) のハイブリッド構成で動作します。ホストの tmux ソケットをマウントし、Cloudflare Tunnel で外部公開されます。',
    usageGuide: '司令塔で全状況を把握し、詳細カードのターミナルで直接指示を出します。Auto-Yes は定型プロンプトを自動処理します。',
    pStandard: '【Standard】設計からリリースまでを網羅する汎用エンジニア。',
    pBug: '【Bug Hunter】既存コードの不具合調査と修正、テスト作成に特化。',
    pArch: '【Architect】実装はせず、高度な技術設計と比較提案に集中。',
    pDoc: '【Doc Pro】READMEやコード内コメント、API仕様書の整備に特化。',
    pCommander: '【Commander】CEO役。複数のエージェントを配下に置き、全体を指揮。',
    shellGuide: '🐚 Shell ボタン: 同じ場所で別のシェルを開いて作業できます。',
    sending: '📡 送信中...',
    orchestrating: '🤝 相談中...',
    userPriority: '⚠️ ユーザー優先',
    syncSize: 'サイズ同期',
    forceAttach: 'Force Attach',
    bigger: '大きく',
    smaller: '小さく',
    clients: 'Clients',
    refresh: 'Refresh',
    live: 'Live',
    sort: 'Sort',
    byActivity: 'Activity',
    byCreated: 'Created',
    byName: 'Name',
    useCwd: 'Use CWD',
    close: '閉じる',
    noClients: '接続中 client はありません',
    readOnlyMirror: 'read-only',
    detach: 'Detach',
    killClient: 'Kill PID',
    readOnlyBadge: 'READ ONLY',
    detachAll: 'Detach All',
    clientSummary: 'Summary',
    mode: 'Mode',
    activity: 'Activity',
    cwd: 'CWD',
    clientsCount: 'Clients',
    copy: 'Copy',
    copied: 'Copied',
  },
  en: {
    title: 'Work OS v0.8.8',
    richMode: 'Rich UI (Color)',
    help: 'Help',
    commander: 'Commander: Global Monitor',
    showPreview: 'Show Preview',
    previewLines: 'Lines',
    autoYes: 'Auto-Yes',
    summary: 'Summary',
    orchestration: 'Orchestration',
    proxySelect: 'Select Proxy',
    noProxy: 'No Proxy',
    launchAgent: 'Launch Agent (Select Personality)',
    sessionName: 'Session Name',
    command: 'Command (e.g. claude)',
    directory: 'Directory (Path)',
    template: 'Personality (Template)',
    noTemplate: 'No Personality',
    installPersonality: 'Install Agent Personalities:',
    duplicate: 'Duplicate Personality',
    launch: 'Launch',
    loading: 'Loading...',
    noSessions: 'No active sessions',
    backToDash: '↑ Back to Monitor',
    howItWorks: 'Principles',
    usage: 'Usage',
    personalityGuide: 'Personalities',
    principles: 'Hybrid architecture: Docker (monitor) + Host (execute). Connects via tmux socket and Cloudflare Tunnel.',
    usageGuide: 'Monitor everything here, act in the terminal cards. Auto-Yes handles routine prompts.',
    pStandard: '[Standard] General engineer covering design to release.',
    pBug: '[Bug Hunter] Specialized in bug fixing, testing, and root cause analysis.',
    pArch: '[Architect] High-level design and tech selection without coding.',
    pDoc: '[Doc Pro] Expert in READMEs, API docs, and code comments.',
    pCommander: '[Commander] CEO role. Manages and coordinates multiple agents.',
    shellGuide: '🐚 Shell button: Open a side-car terminal in the same directory.',
    sending: '📡 Sending...',
    orchestrating: '🤝 Orchestrating...',
    userPriority: '⚠️ User Priority',
    syncSize: 'Sync Size',
    forceAttach: 'Force Attach',
    bigger: 'Larger',
    smaller: 'Smaller',
    clients: 'Clients',
    refresh: 'Refresh',
    live: 'Live',
    sort: 'Sort',
    byActivity: 'Activity',
    byCreated: 'Created',
    byName: 'Name',
    useCwd: 'Use CWD',
    close: 'Close',
    noClients: 'No attached clients',
    readOnlyMirror: 'read-only',
    detach: 'Detach',
    killClient: 'Kill PID',
    readOnlyBadge: 'READ ONLY',
    detachAll: 'Detach All',
    clientSummary: 'Summary',
    mode: 'Mode',
    activity: 'Activity',
    cwd: 'CWD',
    clientsCount: 'Clients',
    copy: 'Copy',
    copied: 'Copied',
  }
};

export default function Home() {
  const [lang, setLang] = useState<'ja' | 'en'>('ja');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRichMode, setIsRichMode] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const [showDashPreview, setShowDashPreview] = useState(false);
  const [isSyncSize, setIsSyncSize] = useState(true);
  const [dashPreviewLines, setDashPreviewLines] = useState(1);
  const [autoYesMap, setAutoYesMap] = useState<Record<string, boolean>>({});
  const [proxyMap, setProxyMap] = useState<Record<string, string>>({});
  const [activeShellMap, setActiveShellMap] = useState<Record<string, string>>({});
  const [terminalModeMap, setTerminalModeMap] = useState<Record<string, 'auto' | 'mirror' | 'readonly-mirror' | 'attach' | 'resize-client'>>({});
  const [terminalHeightMap, setTerminalHeightMap] = useState<Record<string, number>>({});
  const [newSession, setNewSession] = useState({ name: '', command: '', cwd: '', templateName: '' });
  const [sendingStatus, setSendingStatus] = useState<Record<string, boolean>>({});
  const [orchStatus, setOrchStatus] = useState<Record<string, boolean>>({});
  const [userInteractedAt, setUserInteractedAt] = useState<Record<string, number>>({});
  const [killedSessionIds, setKilledSessionIds] = useState<Set<string>>(new Set());
  const [clientsDialog, setClientsDialog] = useState<{
    sessionId: string;
    raw: string;
    clients: Array<{
      raw: string;
      name: string;
      pid: number;
      tty: string;
      size: string;
      created: number;
      activity: number;
      termname: string;
    }>;
  } | null>(null);
  const [clientsLoading, setClientsLoading] = useState<string | null>(null);
  const [clientActionKey, setClientActionKey] = useState<string | null>(null);
  const [copiedPathId, setCopiedPathId] = useState<string | null>(null);
  const [clientSort, setClientSort] = useState<'activity' | 'created' | 'name'>('activity');

  const t = translations[lang];
  const lastPromptedState = useRef<Record<string, string>>({});

  const getTerminalHeight = (id: string) => terminalHeightMap[id] || 450;
  const isShellSession = (sessionId: string) => sessionId.startsWith('sh-');
  const getSessionModeLabel = (session: Session) => terminalModeMap[session.id] || session.suggestedMode || 'auto';
  const getActivityTone = (epochSeconds?: number) => {
    if (!epochSeconds) {
      return { color: '#5f6b7a', border: '#1f2937', background: 'rgba(15, 23, 42, 0.45)' };
    }
    const diff = Math.max(0, Math.floor(Date.now() / 1000) - epochSeconds);
    if (diff < 60) {
      return { color: '#4ade80', border: 'rgba(74, 222, 128, 0.35)', background: 'rgba(20, 83, 45, 0.22)' };
    }
    if (diff < 300) {
      return { color: '#facc15', border: 'rgba(250, 204, 21, 0.32)', background: 'rgba(113, 63, 18, 0.18)' };
    }
    return { color: '#94a3b8', border: '#23374c', background: 'rgba(8, 17, 31, 0.75)' };
  };
  const getClientTone = (count?: number) => {
    if ((count || 0) > 0) {
      return { color: '#9ecbff', border: '#23374c', background: 'rgba(14, 44, 76, 0.28)' };
    }
    return { color: '#66758a', border: '#1f2937', background: 'rgba(15, 23, 42, 0.35)' };
  };
  const formatRelativeTime = (epochSeconds?: number) => {
    if (!epochSeconds) {
      return '-';
    }
    const diff = Math.max(0, Math.floor(Date.now() / 1000) - epochSeconds);
    if (diff < 60) {
      return `${diff}s ago`;
    }
    if (diff < 3600) {
      return `${Math.floor(diff / 60)}m ago`;
    }
    if (diff < 86400) {
      return `${Math.floor(diff / 3600)}h ago`;
    }
    return `${Math.floor(diff / 86400)}d ago`;
  };
  const compactPath = (value?: string) => {
    if (!value) {
      return '-';
    }
    if (value.length <= 44) {
      return value;
    }
    return `...${value.slice(-41)}`;
  };
  const changeTerminalHeight = (id: string, delta: number) => {
    setTerminalHeightMap((prev) => ({
      ...prev,
      [id]: Math.max(320, Math.min(960, (prev[id] || 450) + delta)),
    }));
  };
  const getSortScore = (session: Session) => {
    const waitingBoost = session.isWaitingForInput ? 10 ** 12 : 0;
    return waitingBoost + (session.lastActivity || 0);
  };
  const copyPath = async (sessionId: string, value?: string) => {
    if (!value) {
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setCopiedPathId(sessionId);
      window.setTimeout(() => {
        setCopiedPathId((prev) => (prev === sessionId ? null : prev));
      }, 1200);
    } catch (error) {
      console.error('Failed to copy path', error);
    }
  };

  const fetchSessions = async () => {
    try {
      const res = await fetch('/api/sessions');
      const data = await res.json();
      if (data.sessions) {
        const filteredSessions = data.sessions.filter((s: Session) => !killedSessionIds.has(s.id));
        const updatedSessions = await Promise.all(
          filteredSessions.map(async (s: Session) => {
            if (isShellSession(s.id)) {
              return {
                ...s,
                summary: 'Shell',
                isWaitingForInput: false,
              };
            }
            try {
              const capRes = await fetch(`/api/sessions/${s.id}`);
              const capData = await capRes.json();
              const lastInteraction = userInteractedAt[s.id] || 0;
              const isInterrupted = (Date.now() - lastInteraction) < 30000;
              if (!isInterrupted && autoYesMap[s.id] && capData.isWaitingForInput && !sendingStatus[s.id]) {
                sendKey(s.id, 'y Enter');
              }
              const proxyId = proxyMap[s.id];
              if (!isInterrupted && proxyId && capData.isWaitingForInput && !sendingStatus[s.id] && !orchStatus[s.id]) {
                const currentContext = capData.content.split('\n').slice(-5).join('\n');
                if (lastPromptedState.current[s.id] !== currentContext) {
                  lastPromptedState.current[s.id] = currentContext;
                  runOrchestration(s.id, proxyId, currentContext);
                }
              }
              const lines = capData.content.trim().split('\n');
              const relevantLine = lines.reverse().find((l: string) =>
                l.includes('✔') || l.includes('✖') || l.includes('error') || l.includes('done') || l.length > 10
              );
              const summary = relevantLine ? relevantLine.replace(/\x1b\[[0-9;]*m/g, '').trim().substring(0, 50) : 'Idle';
              return { ...s, ...capData, summary, isInterrupted };
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

  const runOrchestration = async (workerId: string, proxyId: string, context: string) => {
    setOrchStatus(prev => ({ ...prev, [workerId]: true }));
    try {
      const prompt = `\n[WORK OS SYSTEM]: Session "${workerId}" needs input.\n--- CONTEXT ---\n${context}\n---------------\nWhat is the best input? Provide ONLY the raw text to send. (e.g. 1, y, or a command)\n`;
      await fetch(`/api/sessions/${proxyId}/send-key`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: prompt + ' Enter' }) });
      setTimeout(async () => {
        if ((Date.now() - (userInteractedAt[workerId] || 0)) < 30000) { setOrchStatus(prev => ({ ...prev, [workerId]: false })); return; }
        const res = await fetch(`/api/sessions/${proxyId}`);
        const data = await res.json();
        const lines = data.content.trim().split('\n');
        const lastLine = lines[lines.length - 1];
        if (lastLine && lastLine.length < 100) { await sendKey(workerId, lastLine + ' Enter', true); }
        setOrchStatus(prev => ({ ...prev, [workerId]: false }));
      }, 5000);
    } catch (error) {
      console.error('Orchestration failed', error);
      setOrchStatus(prev => ({ ...prev, [workerId]: false }));
    }
  };

  const fetchTemplates = async () => {
    try {
      const res = await fetch('/api/templates');
      const data = await res.json();
      setTemplates(data.templates || []);
    } catch (error) {
      console.error('Failed to fetch templates', error);
    }
  };

  const initTemplate = async (sourceLang: 'ja' | 'en', sourceSubDir: string) => {
    try {
      await fetch('/api/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'init', sourceLang, sourceSubDir }) });
      fetchTemplates();
    } catch (error) {
      console.error('Failed to init template', error);
    }
  };

  const duplicateTemplate = async (sourceName: string) => {
    const newName = prompt('Enter new personality name:', `${sourceName}-copy`);
    if (!newName) return;
    try {
      await fetch('/api/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'duplicate', sourceName, name: newName }) });
      fetchTemplates();
    } catch (error) {
      console.error('Failed to duplicate template', error);
    }
  };

  const startSession = async (name: string, command: string, cwd?: string, templateName?: string) => {
    if (!name || !command) return;
    try {
      await fetch('/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, command, cwd, templateName }) });
      fetchSessions();
      setNewSession({ ...newSession, name: '' });
    } catch (error) {
      console.error('Failed to start session', error);
    }
  };

  const sendKey = async (id: string, key: string, isAuto: boolean = false) => {
    if (!isAuto) { setUserInteractedAt(prev => ({ ...prev, [id]: Date.now() })); }
    if (sendingStatus[id]) return;
    setSendingStatus(prev => ({ ...prev, [id]: true }));
    try {
      await fetch(`/api/sessions/${id}/send-key`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) });
      const refresh = async () => {
        const capRes = await fetch(`/api/sessions/${id}`);
        const capData = await capRes.json();
        setSessions(prev => prev.map(s => s.id === id ? { ...s, content: capData.content, isWaitingForInput: capData.isWaitingForInput } : s));
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
    setKilledSessionIds(prev => new Set(prev).add(id));
    setSessions(prev => prev.filter(s => s.id !== id));
    setActiveShellMap(prev => {
      const next = { ...prev };
      Object.keys(next).forEach(key => { if (next[key] === id) delete next[key]; });
      delete next[id];
      return next;
    });
    try {
      await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
      setTimeout(fetchSessions, 1000);
    } catch (error) {
      console.error('Failed to kill session', error);
      setKilledSessionIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      fetchSessions();
    }
  };

  const enterShell = async (id: string) => {
    try {
      const res = await fetch(`/api/sessions/${id}/shell`, { method: 'POST' });
      const data = await res.json();
      if (data.newSession) { setActiveShellMap(prev => ({ ...prev, [id]: data.newSession })); }
      fetchSessions();
    } catch (error) {
      console.error('Failed to open shell', error);
    }
  };

  const loadClientsDialog = async (id: string) => {
    setClientsLoading(id);
    try {
      const res = await fetch(`/api/sessions/${id}/clients`);
      const data = await res.json();
      setClientsDialog({
        sessionId: id,
        raw: data.raw || '',
        clients: data.clients || [],
      });
    } catch (error) {
      console.error('Failed to list clients', error);
      setClientsDialog({
        sessionId: id,
        raw: '',
        clients: [],
      });
    } finally {
      setClientsLoading(null);
    }
  };

  const openClientsDialog = async (id: string) => {
    await loadClientsDialog(id);
  };

  const runClientAction = async (
    sessionId: string,
    client: { tty: string; pid: number } | null,
    action: 'detach' | 'kill' | 'detach-all'
  ) => {
    const actionKey = `${sessionId}:${client?.tty || 'all'}:${action}`;
    setClientActionKey(actionKey);
    try {
      await fetch(`/api/sessions/${sessionId}/clients`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          tty: client?.tty,
          pid: client?.pid,
        }),
      });
      await loadClientsDialog(sessionId);
    } catch (error) {
      console.error('Failed to control client', error);
    } finally {
      setClientActionKey(null);
    }
  };

  useEffect(() => {
    fetchSessions();
    fetchTemplates();
    const interval = setInterval(fetchSessions, 2000);
    return () => clearInterval(interval);
  }, [proxyMap, autoYesMap, userInteractedAt, killedSessionIds]);

  useEffect(() => {
    if (!clientsDialog) {
      return;
    }
    const interval = window.setInterval(() => {
      loadClientsDialog(clientsDialog.sessionId);
    }, 2000);
    return () => window.clearInterval(interval);
  }, [clientsDialog?.sessionId]);

  const topLevelSessions = [...sessions.filter((s) => !s.name.startsWith('sh-'))].sort((a, b) => {
    const scoreDiff = getSortScore(b) - getSortScore(a);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
    return a.name.localeCompare(b.name);
  });

  const commanderSessions = [...sessions].sort((a, b) => {
    const scoreDiff = getSortScore(b) - getSortScore(a);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
    return a.name.localeCompare(b.name);
  });

  const sortedClients = clientsDialog
    ? [...clientsDialog.clients].sort((a, b) => {
        if (clientSort === 'activity') {
          return (b.activity || 0) - (a.activity || 0);
        }
        if (clientSort === 'created') {
          return (b.created || 0) - (a.created || 0);
        }
        return (a.name || a.tty).localeCompare(b.name || b.tty);
      })
    : [];

  return (
    <main>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1 style={{ margin: 0 }}>{t.title}</h1>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <button onClick={() => setLang(lang === 'ja' ? 'en' : 'ja')} style={{ background: '#333', fontSize: '0.75rem', padding: '0.4rem 0.8rem', borderRadius: '4px', border: '1px solid #444', color: '#fff', cursor: 'pointer' }}>{lang === 'ja' ? 'EN' : '日本語'}</button>
          <button onClick={() => setShowHelp(!showHelp)} style={{ background: showHelp ? 'var(--accent)' : '#333', color: showHelp ? '#000' : '#fff', fontSize: '0.75rem', padding: '0.4rem 0.8rem', borderRadius: '4px', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>{t.help}</button>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', cursor: 'pointer', color: '#888' }}><input type="checkbox" checked={isRichMode} onChange={(e) => setIsRichMode(e.target.checked)} />{t.richMode}</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', cursor: 'pointer', color: '#888' }}><input type="checkbox" checked={isSyncSize} onChange={(e) => setIsSyncSize(e.target.checked)} />{t.syncSize}</label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={() => startSession(`claude-${Date.now().toString().slice(-4)}`, 'claude', newSession.cwd, newSession.templateName)}>+ Claude</button>
            <button onClick={() => startSession(`gemini-${Date.now().toString().slice(-4)}`, 'gemini', newSession.cwd, newSession.templateName)}>+ Gemini</button>
          </div>
        </div>
      </header>

      {showHelp && (
        <section style={{ marginBottom: '2rem', padding: '1rem', background: '#1a1a2e', borderRadius: '8px', border: '1px solid #3f3f5f', fontSize: '0.9rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem' }}>
            <div><h3 style={{ color: 'var(--accent)', marginTop: 0 }}>{t.howItWorks}</h3><p style={{ color: '#ccc', lineHeight: '1.4', margin: 0 }}>{t.principles}</p></div>
            <div><h3 style={{ color: 'var(--accent)', marginTop: 0 }}>{t.usage}</h3><p style={{ color: '#ccc', lineHeight: '1.4', margin: 0 }}>{t.usageGuide}</p><p style={{ color: '#aaa', fontSize: '0.8rem', marginTop: '0.5rem' }}>{t.shellGuide}</p></div>
            <div><h3 style={{ color: 'var(--accent)', marginTop: 0 }}>{t.personalityGuide}</h3>
              <ul style={{ color: '#ccc', fontSize: '0.8rem', paddingLeft: '1.2rem', margin: 0 }}>
                <li>{t.pStandard}</li><li>{t.pBug}</li><li>{t.pArch}</li><li>{t.pDoc}</li><li>{t.pCommander}</li>
              </ul>
            </div>
          </div>
        </section>
      )}

      <section style={{ marginBottom: '2rem', background: '#111', padding: '1rem', borderRadius: '8px', border: '1px solid var(--accent)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '0.9rem', margin: 0, color: 'var(--accent)' }}>{t.commander}</h2>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', fontSize: '0.75rem', color: '#888' }}>
            <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem' }}><input type="checkbox" checked={showDashPreview} onChange={(e) => setShowDashPreview(e.target.checked)} /> {t.showPreview}</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>{t.previewLines}: <input type="number" value={dashPreviewLines} onChange={(e) => setDashPreviewLines(parseInt(e.target.value) || 1)} style={{ width: '40px', background: '#000', color: '#fff', border: '1px solid #333', textAlign: 'center' }} /></div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {commanderSessions.map(s => (
            <div key={s.id} id={`row-${s.id}`} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '0.5rem', background: s.isWaitingForInput ? '#2a2a00' : 'transparent', borderBottom: '1px solid #222' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', fontSize: '0.85rem' }}>
                <a href={`#card-${s.id}`} style={{ color: s.isWaitingForInput ? '#ffeb3b' : '#fff', fontWeight: 'bold', width: '120px', textDecoration: 'none' }}>{s.isWaitingForInput ? '⚡ ' : ''}{s.name}</a>
                <span style={{ flex: 1, color: s.isWaitingForInput ? '#ffeb3b' : '#ccc', fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.summary}</span>
                <span style={{ width: '80px', color: s.isAttached ? '#00ff88' : '#555', textAlign: 'right' }}>{s.isAttached ? '● active' : '○ idle'}</span>
              </div>
              {showDashPreview && (
                <div style={{ fontSize: '0.75rem', fontFamily: 'monospace', background: '#000', padding: '0.4rem', borderRadius: '4px', border: '1px solid #222', overflow: 'hidden', maxHeight: '100px', color: s.isWaitingForInput ? '#ffeb3b' : '#ccc' }}>
                  {isRichMode ? (<div dangerouslySetInnerHTML={{ __html: converter.toHtml((s.content || '').split('\n').slice(-dashPreviewLines).join('\n')) }} />) : (<pre style={{ margin: 0 }}>{(s.content || '').split('\n').slice(-dashPreviewLines).join('\n')}</pre>)}
                </div>
              )}
            </div>
          ))}
          {sessions.length === 0 && <p style={{ fontSize: '0.8rem', color: '#555' }}>{t.noSessions}</p>}
        </div>
      </section>

      <section style={{ marginBottom: '2rem', background: 'var(--card-bg)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--card-border)' }}>
        <h2 style={{ fontSize: '1rem', marginBottom: '1rem', color: 'var(--text-dim)' }}>{t.launchAgent}</h2>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          <input type="text" placeholder={t.sessionName} value={newSession.name} onChange={(e) => setNewSession({ ...newSession, name: e.target.value })} style={{ background: '#000', color: '#fff', border: '1px solid #333', padding: '0.5rem', borderRadius: '4px', flex: 1, minWidth: '150px' }} />
          <input type="text" placeholder={t.command} value={newSession.command} onChange={(e) => setNewSession({ ...newSession, command: e.target.value })} style={{ background: '#000', color: '#fff', border: '1px solid #333', padding: '0.5rem', borderRadius: '4px', flex: 2, minWidth: '200px' }} />
          <input type="text" placeholder={t.directory} value={newSession.cwd} onChange={(e) => setNewSession({ ...newSession, cwd: e.target.value })} style={{ background: '#000', color: '#fff', border: '1px solid #333', padding: '0.5rem', borderRadius: '4px', flex: 2, minWidth: '200px' }} />
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={newSession.templateName} onChange={(e) => setNewSession({ ...newSession, templateName: e.target.value })} style={{ background: '#000', color: '#fff', border: '1px solid #333', padding: '0.5rem', borderRadius: '4px', flex: 1 }}>
            <option value="">{t.noTemplate}</option>
            {templates.map(tmp => <option key={tmp.name} value={tmp.name}>{tmp.name}</option>)}
          </select>
          {templates.length === 0 ? (
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.7rem', color: '#666' }}>{t.installPersonality}</span>
              <button onClick={() => initTemplate('ja', 'standard')} style={{ fontSize: '0.6rem' }}>Standard</button><button onClick={() => initTemplate('ja', 'bug-hunter')} style={{ fontSize: '0.6rem' }}>Bug Hunter</button><button onClick={() => initTemplate('ja', 'arch-consultant')} style={{ fontSize: '0.6rem' }}>Architect</button><button onClick={() => initTemplate('ja', 'doc-expert')} style={{ fontSize: '0.6rem' }}>Doc Pro</button><button onClick={() => initTemplate('ja', 'commander')} style={{ fontSize: '0.6rem' }}>Commander</button>
            </div>
          ) : (
            newSession.templateName && <button onClick={() => duplicateTemplate(newSession.templateName)} style={{ fontSize: '0.7rem' }}>{t.duplicate}</button>
          )}
          <button onClick={() => startSession(newSession.name, newSession.command, newSession.cwd, newSession.templateName)} style={{ flex: 1 }}>{t.launch}</button>
        </div>
        <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
          <button onClick={() => setNewSession({ ...newSession, cwd: '/mnt/c/var/work/work-os' })} style={{ background: 'transparent', border: '1px solid #444', color: '#888', fontSize: '0.7rem' }}>📍 work-os</button>
        </div>
        {newSession.templateName && (
          <div style={{ marginTop: '1rem', padding: '0.5rem', background: '#000', borderRadius: '4px', border: '1px solid #222' }}>
            <pre style={{ fontSize: '0.7rem', color: '#888', whiteSpace: 'pre-wrap', margin: 0 }}>{templates.find(tmp => tmp.name === newSession.templateName)?.description}</pre>
          </div>
        )}
      </section>

      <div className="session-grid">
        {topLevelSessions.map((session) => {
          const childShells = sessions
            .filter(s => s.name.startsWith(`sh-${session.name}-`))
            .sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0) || a.name.localeCompare(b.name));
          const lastInteraction = userInteractedAt[session.id] || 0;
          const isInterrupted = (Date.now() - lastInteraction) < 30000;
          const sessionActivityTone = getActivityTone(session.lastActivity);
          const sessionClientTone = getClientTone(session.clientCount);
          return (
            <div key={session.id} style={{ display: 'contents' }}>
              <div id={`card-${session.id}`} className="session-card" style={{ opacity: sendingStatus[session.id] ? 0.7 : 1, transition: 'opacity 0.2s', border: session.isWaitingForInput ? '1px solid #ffeb3b' : '1px solid var(--card-border)' }}>
                <div className="session-header">
                  <span className="session-name">{session.name} {session.isWaitingForInput && <span style={{ marginLeft: '10px', fontSize: '0.7rem', color: '#ffeb3b' }}>⚡ INPUT WAITING</span>} {sendingStatus[session.id] && <span style={{ marginLeft: '10px', fontSize: '0.7rem', color: 'var(--accent)' }}>{t.sending}</span>} {orchStatus[session.id] && !isInterrupted && <span style={{ marginLeft: '10px', fontSize: '0.7rem', color: '#00d1b2' }}>{t.orchestrating}</span>} {isInterrupted && <span style={{ marginLeft: '10px', fontSize: '0.7rem', color: '#ff4444' }}>{t.userPriority}</span>}</span>
                  <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <select value={proxyMap[session.id] || ''} onChange={(e) => setProxyMap({ ...proxyMap, [session.id]: e.target.value })} style={{ background: '#000', color: '#aaa', border: '1px solid #333', fontSize: '0.7rem', padding: '0.1rem', borderRadius: '4px' }}>
                      <option value="">🤝 {t.noProxy}</option>
                      {sessions.filter(p => p.id !== session.id).map(p => <option key={p.id} value={p.id}>🤝 {p.name}</option>)}
                    </select>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.7rem', color: '#888', cursor: 'pointer' }}><input type="checkbox" checked={autoYesMap[session.id] || false} onChange={(e) => setAutoYesMap({ ...autoYesMap, [session.id]: e.target.checked })} /> {t.autoYes}</label>
                    <select
                      value={terminalModeMap[session.id] || 'auto'}
                      onChange={(e) => setTerminalModeMap((prev) => ({ ...prev, [session.id]: e.target.value as 'auto' | 'mirror' | 'readonly-mirror' | 'attach' | 'resize-client' }))}
                      style={{ background: '#000', color: '#88d8cf', border: '1px solid #2d4a4a', fontSize: '0.7rem', padding: '0.15rem 0.3rem', borderRadius: '4px' }}
                    >
                      <option value="auto">auto</option>
                      <option value="mirror">mirror</option>
                      <option value="readonly-mirror">{t.readOnlyMirror}</option>
                      <option value="attach">attach</option>
                      <option value="resize-client">resize-client</option>
                    </select>
                    {(terminalModeMap[session.id] || 'auto') === 'readonly-mirror' ? (
                      <span style={{ fontSize: '0.68rem', color: '#e6c66b', border: '1px solid rgba(230,198,107,0.35)', borderRadius: '999px', padding: '0.12rem 0.5rem' }}>{t.readOnlyBadge}</span>
                    ) : null}
                    <button onClick={() => changeTerminalHeight(session.id, -120)} style={{ background: 'transparent', color: '#aaa', border: '1px solid #333', fontSize: '0.7rem' }}>{t.smaller}</button>
                    <button onClick={() => changeTerminalHeight(session.id, 120)} style={{ background: 'transparent', color: 'var(--accent)', border: '1px solid #2d4a4a', fontSize: '0.7rem' }}>{t.bigger}</button>
                    <span className={`session-status ${session.isAttached ? 'status-active' : ''}`}>{session.isAttached ? 'Attached' : 'Idle'}</span>
                  </div>
                </div>
                <div style={{ marginTop: '0.5rem' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem 0.8rem', marginBottom: '0.75rem', color: '#8fa3ba', fontSize: '0.74rem', lineHeight: 1.3 }}>
                    <span>{t.mode}: {getSessionModeLabel(session)}</span>
                    <button
                      onClick={() => openClientsDialog(session.id)}
                      style={{
                        background: sessionClientTone.background,
                        color: sessionClientTone.color,
                        border: `1px solid ${sessionClientTone.border}`,
                        padding: '0.08rem 0.45rem',
                        fontSize: '0.72rem',
                        cursor: 'pointer',
                        borderRadius: '999px',
                      }}
                    >
                      {t.clientsCount}: {session.clientCount || 0}
                    </button>
                    <span
                      style={{
                        color: sessionActivityTone.color,
                        border: `1px solid ${sessionActivityTone.border}`,
                        background: sessionActivityTone.background,
                        borderRadius: '999px',
                        padding: '0.08rem 0.45rem',
                      }}
                    >
                      {t.activity}: {formatRelativeTime(session.lastActivity)}
                    </span>
                    <button
                      onClick={() => copyPath(session.id, session.currentPath || session.directory)}
                      title={session.currentPath || session.directory || '-'}
                      style={{ background: 'transparent', color: '#8fa3ba', border: 'none', padding: 0, fontSize: '0.74rem', cursor: 'pointer' }}
                    >
                      {t.cwd}: {compactPath(session.currentPath || session.directory)} {copiedPathId === session.id ? `(${t.copied})` : ''}
                    </button>
                    <span title={session.currentCommand || session.command || '-'}>cmd: {session.currentCommand || session.command || '-'}</span>
                  </div>
                  <Terminal
                    key={`${session.id}:${terminalModeMap[session.id] || 'auto'}:${getTerminalHeight(session.id)}`}
                    sessionId={session.id}
                    syncSize={isSyncSize}
                    preferredMode={terminalModeMap[session.id] || 'auto'}
                    height={getTerminalHeight(session.id)}
                  />
                </div>
                <div className="session-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1rem' }}>
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    <button onClick={() => openClientsDialog(session.id)} style={{ background: 'transparent', color: '#9ecbff', border: '1px solid #23374c', fontSize: '0.7rem' }}>{clientsLoading === session.id ? '...' : t.clients}</button>
                    <button
                      onClick={() => setNewSession((prev) => ({ ...prev, cwd: session.currentPath || session.directory || prev.cwd }))}
                      style={{ background: 'transparent', color: '#c7e87b', border: '1px solid #31461f', fontSize: '0.7rem' }}
                    >
                      {t.useCwd}
                    </button>
                    <button onClick={() => window.open(`/api/sessions/${session.id}`, '_blank')} style={{ background: 'transparent', color: 'var(--text-dim)', border: '1px solid #333', fontSize: '0.7rem' }}>Raw</button>
                    <button onClick={() => enterShell(session.id)} style={{ background: 'transparent', color: 'var(--accent)', border: '1px solid #2d4a4a', fontSize: '0.7rem' }}>🐚 Shell</button>
                    <button onClick={() => killSession(session.id)} style={{ background: 'transparent', color: '#ff4444', border: '1px solid #442222', fontSize: '0.7rem' }}>Kill</button>
                  </div>
                </div>
                <div style={{ marginTop: '0.5rem', display: 'flex', justifyContent: 'center' }}><a href={`#row-${session.id}`} style={{ fontSize: '0.7rem', color: 'var(--accent)', textDecoration: 'none' }}>{t.backToDash}</a></div>
              </div>
              {childShells.map(shell => (
                <div key={shell.id} id={`card-${shell.id}`} className="session-card" style={{ marginLeft: '2rem', border: '1px solid var(--accent)', background: '#050505', marginTop: '-1rem', marginBottom: '2rem' }}>
                  <div className="session-header">
                    <span className="session-name" style={{ color: 'var(--accent)' }}>🐚 Shell for {session.name}</span>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <select
                        value={terminalModeMap[shell.id] || 'attach'}
                        onChange={(e) => setTerminalModeMap((prev) => ({ ...prev, [shell.id]: e.target.value as 'auto' | 'mirror' | 'readonly-mirror' | 'attach' | 'resize-client' }))}
                        style={{ background: '#000', color: '#88d8cf', border: '1px solid #2d4a4a', fontSize: '0.7rem', padding: '0.15rem 0.3rem', borderRadius: '4px' }}
                      >
                        <option value="attach">attach</option>
                        <option value="resize-client">resize-client</option>
                        <option value="mirror">mirror</option>
                        <option value="readonly-mirror">{t.readOnlyMirror}</option>
                      </select>
                      {(terminalModeMap[shell.id] || 'attach') === 'readonly-mirror' ? (
                        <span style={{ fontSize: '0.68rem', color: '#e6c66b', border: '1px solid rgba(230,198,107,0.35)', borderRadius: '999px', padding: '0.12rem 0.5rem' }}>{t.readOnlyBadge}</span>
                      ) : null}
                      <button onClick={() => changeTerminalHeight(shell.id, -120)} style={{ background: 'transparent', color: '#aaa', border: '1px solid #333', fontSize: '0.7rem' }}>{t.smaller}</button>
                      <button onClick={() => changeTerminalHeight(shell.id, 120)} style={{ background: 'transparent', color: 'var(--accent)', border: '1px solid #2d4a4a', fontSize: '0.7rem' }}>{t.bigger}</button>
                      <span className="session-status status-active">LIVE</span>
                    </div>
                  </div>
                  <div style={{ marginTop: '0.5rem' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem 0.8rem', marginBottom: '0.75rem', color: '#8fa3ba', fontSize: '0.74rem', lineHeight: 1.3 }}>
                      <span>{t.mode}: {getSessionModeLabel(shell)}</span>
                      <button
                        onClick={() => openClientsDialog(shell.id)}
                        style={{
                          background: getClientTone(shell.clientCount).background,
                          color: getClientTone(shell.clientCount).color,
                          border: `1px solid ${getClientTone(shell.clientCount).border}`,
                          padding: '0.08rem 0.45rem',
                          fontSize: '0.72rem',
                          cursor: 'pointer',
                          borderRadius: '999px',
                        }}
                      >
                        {t.clientsCount}: {shell.clientCount || 0}
                      </button>
                      <span
                        style={{
                          color: getActivityTone(shell.lastActivity).color,
                          border: `1px solid ${getActivityTone(shell.lastActivity).border}`,
                          background: getActivityTone(shell.lastActivity).background,
                          borderRadius: '999px',
                          padding: '0.08rem 0.45rem',
                        }}
                      >
                        {t.activity}: {formatRelativeTime(shell.lastActivity)}
                      </span>
                      <button
                        onClick={() => copyPath(shell.id, shell.currentPath || shell.directory)}
                        title={shell.currentPath || shell.directory || '-'}
                        style={{ background: 'transparent', color: '#8fa3ba', border: 'none', padding: 0, fontSize: '0.74rem', cursor: 'pointer' }}
                      >
                        {t.cwd}: {compactPath(shell.currentPath || shell.directory)} {copiedPathId === shell.id ? `(${t.copied})` : ''}
                      </button>
                      <span title={shell.currentCommand || shell.command || '-'}>cmd: {shell.currentCommand || shell.command || '-'}</span>
                    </div>
                    <Terminal
                      key={`${shell.id}:${getTerminalHeight(shell.id)}`}
                      sessionId={shell.id}
                      onClose={() => killSession(shell.id)}
                      syncSize={isSyncSize}
                      preferredMode={terminalModeMap[shell.id] || 'attach'}
                      height={getTerminalHeight(shell.id)}
                    />
                  </div>
                  <div className="session-footer" style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}><div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}><button onClick={() => openClientsDialog(shell.id)} style={{ background: 'transparent', color: '#9ecbff', border: '1px solid #23374c', fontSize: '0.7rem' }}>{clientsLoading === shell.id ? '...' : t.clients}</button><button onClick={() => setNewSession((prev) => ({ ...prev, cwd: shell.currentPath || shell.directory || prev.cwd }))} style={{ background: 'transparent', color: '#c7e87b', border: '1px solid #31461f', fontSize: '0.7rem' }}>{t.useCwd}</button><button onClick={() => killSession(shell.id)} style={{ background: 'transparent', color: '#ff4444', border: '1px solid #442222', fontSize: '0.7rem' }}>Kill Shell</button><a href={`#row-${shell.id}`} style={{ fontSize: '0.7rem', color: 'var(--accent)', textDecoration: 'none' }}>{t.backToDash}</a></div></div>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {clientsDialog ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.72)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2rem',
            zIndex: 1000,
          }}
          onClick={() => setClientsDialog(null)}
        >
          <div
            style={{
              width: 'min(900px, 100%)',
              maxHeight: '80vh',
              overflow: 'auto',
              background: '#0b121d',
              border: '1px solid #23374c',
              borderRadius: '16px',
              boxShadow: '0 18px 60px rgba(0,0,0,0.45)',
              padding: '1rem',
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div>
                <div style={{ color: '#9ecbff', fontSize: '0.8rem' }}>tmux list-clients</div>
                <div style={{ color: '#fff', fontWeight: 700 }}>{clientsDialog.sessionId}</div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <select
                  value={clientSort}
                  onChange={(event) => setClientSort(event.target.value as 'activity' | 'created' | 'name')}
                  style={{ background: '#08111f', color: '#d7e3f4', border: '1px solid #23374c', fontSize: '0.72rem', padding: '0.18rem 0.32rem', borderRadius: '4px' }}
                >
                  <option value="activity">{t.sort}: {t.byActivity}</option>
                  <option value="created">{t.sort}: {t.byCreated}</option>
                  <option value="name">{t.sort}: {t.byName}</option>
                </select>
                <span
                  style={{
                    color: '#4ade80',
                    border: '1px solid rgba(74, 222, 128, 0.35)',
                    background: 'rgba(20, 83, 45, 0.22)',
                    borderRadius: '999px',
                    padding: '0.12rem 0.5rem',
                    fontSize: '0.72rem',
                  }}
                >
                  {t.live}
                </span>
                <button
                  onClick={() => loadClientsDialog(clientsDialog.sessionId)}
                  style={{ background: 'transparent', color: '#9ecbff', border: '1px solid #23374c', fontSize: '0.75rem' }}
                >
                  {clientsLoading === clientsDialog.sessionId ? '...' : t.refresh}
                </button>
                <button onClick={() => setClientsDialog(null)} style={{ background: 'transparent', color: '#fff', border: '1px solid #334155', fontSize: '0.75rem' }}>{t.close}</button>
              </div>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: '1rem',
                alignItems: 'center',
                flexWrap: 'wrap',
                padding: '0.85rem',
                marginBottom: '1rem',
                borderRadius: '12px',
                border: '1px solid #1e293b',
                background: '#08111f',
              }}
            >
              <div style={{ display: 'grid', gap: '0.3rem' }}>
                <div style={{ color: '#9ecbff', fontSize: '0.8rem' }}>{t.clientSummary}</div>
                <div style={{ color: '#d7e3f4', fontSize: '0.85rem' }}>
                  clients: {clientsDialog.clients.length} / raw lines: {clientsDialog.raw ? clientsDialog.raw.split('\n').length : 0}
                </div>
                <div style={{ color: '#94a3b8', fontSize: '0.78rem' }}>
                  last activity: {formatRelativeTime(Math.max(0, ...clientsDialog.clients.map((client) => client.activity || 0)))}
                </div>
              </div>
              <button
                onClick={() => runClientAction(clientsDialog.sessionId, null, 'detach-all')}
                style={{ background: 'transparent', color: '#9ecbff', border: '1px solid #23374c', fontSize: '0.75rem' }}
              >
                {clientActionKey === `${clientsDialog.sessionId}:all:detach-all` ? '...' : t.detachAll}
              </button>
            </div>
            {clientsDialog.clients.length === 0 ? (
              <div style={{ color: '#94a3b8', fontSize: '0.9rem' }}>{t.noClients}</div>
            ) : (
              <div style={{ display: 'grid', gap: '0.75rem', marginBottom: '1rem' }}>
                {sortedClients.map((client) => {
                  const detachKey = `${clientsDialog.sessionId}:${client.tty}:detach`;
                  const killKey = `${clientsDialog.sessionId}:${client.tty}:kill`;
                  return (
                    <div
                      key={client.raw}
                      style={{
                        display: 'grid',
                        gap: '0.5rem',
                        padding: '0.85rem',
                        borderRadius: '12px',
                        border: '1px solid #1e293b',
                        background: '#08111f',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <div style={{ color: '#d7e3f4', fontWeight: 600 }}>{client.name || client.tty}</div>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button
                            onClick={() => runClientAction(clientsDialog.sessionId, client, 'detach')}
                            style={{ background: 'transparent', color: '#9ecbff', border: '1px solid #23374c', fontSize: '0.72rem' }}
                          >
                            {clientActionKey === detachKey ? '...' : t.detach}
                          </button>
                          <button
                            onClick={() => runClientAction(clientsDialog.sessionId, client, 'kill')}
                            style={{ background: 'transparent', color: '#ffb4b4', border: '1px solid #4c2323', fontSize: '0.72rem' }}
                          >
                            {clientActionKey === killKey ? '...' : t.killClient}
                          </button>
                        </div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.5rem', color: '#94a3b8', fontSize: '0.78rem' }}>
                        <div>tty: {client.tty}</div>
                        <div>pid: {client.pid}</div>
                        <div>size: {client.size}</div>
                        <div>term: {client.termname}</div>
                        <div>created: {formatRelativeTime(client.created)}</div>
                        <div>activity: {formatRelativeTime(client.activity)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <pre
              style={{
                margin: 0,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                color: '#d7e3f4',
                background: '#08111f',
                border: '1px solid #1e293b',
                borderRadius: '12px',
                padding: '1rem',
                fontSize: '0.8rem',
                lineHeight: 1.5,
              }}
            >
              {clientsDialog.raw || t.noClients}
            </pre>
          </div>
        </div>
      ) : null}
    </main>
  );
}
