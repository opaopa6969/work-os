# Work OS Specs (v0.2.0)

## 1. 目的
複数の Coding Agent を一括管理し、意思決定のボトルネックを解消する「司令塔」として機能させる。

## 2. アーキテクチャ (v0.2.0)
- **Monitoring (Docker):** Next.js + WebSocket (Socket.io).
- **Execution (Host/WSL):** `tmux` 上の AI Agent 群。
- **Bridge:** Unix Socket マウント + **Pseudo-terminal (PTY) Bridge**.

## 3. インテリジェンス機能
- **Input Detection (Enhanced):** ターミナル出力を解析し、y/n 形式だけでなく、番号選択肢形式 (1. Allow once等) の入力待ちも判定。
- **Auto-Yes:** 特定のプロンプトを検知した際、自動で 'y' を返答。

## 4. コア機能
- **Commander View:** 全セッションの一括監視。
- **Interactive Shell (v0.2.0):** 
    - `xterm.js` によるリアルタイム・インタラクティブ・ターミナル。
    - 起動元セッションの直下に表示。
    - シェル専用の簡素化された UI。
- **i18n Help:** 日英対応。

## 5. 技術スタック
- **Frontend:** React + xterm.js + Socket.io-client
- **Backend:** Next.js + Socket.io + node-pty
- **Infrastructure:** Cloudflare Tunnel
