# Work OS Architecture: Hybrid Strategy

## 1. 構成の概要
Work OS は「監視・操作用コントロールパネル（Docker）」と「エージェント実行環境（Host/WSL）」を分離したハイブリッド構成を採用する。

- **Control Plane (Docker):** Next.js アプリケーション、Cloudflare Tunnel。
- **Data Plane (Host/WSL):** 各種 AI Agent (Claude Code, Codex, Gemini CLI等)、開発言語ランタイム (Node, Python, Go等)。

## 2. 決定の背景（なぜハイブリッドか？）
5つ以上のエージェントをフル稼働させるにあたり、以下の課題を解決するため。

1. **I/O パフォーマンスの維持:** Docker マウント越しの大規模なファイル操作（npm install, build等）による遅延を回避し、ホストネイティブの速度でエージェントを動作させる。
2. **依存関係の分離:** 全プロジェクトのランタイムを Docker イメージに詰め込むことによるイメージの巨大化とメンテナンスコストの増大を防ぐ。
3. **環境の一貫性:** 開発者が普段使っている WSL 上の設定（.gitconfig, SSH Keys, .bashrc等）をそのままエージェントに利用させる。
4. **安定性:** UI 側のアップデートや Docker の再起動が、実行中のエージェントセッションに影響を与えないようにする。

## 3. 連携の仕組み
- Docker コンテナにホストの `tmux` ソケット（`/tmp/tmux-1000/`）をマウントして操作。
- **現在の方式 (v0.7.x):** ポーリング描画。
  - `tmux capture-pane` を定期実行し、画面の「スナップショット」を WebSocket で送信。
  - シンプルだが、カーソル同期や動的リサイズに課題がある。
- **次世代の方式 (v0.8.x 計画):** PTY ストリーミング。
  - `node-pty` を介して `tmux attach` をストリーミング。
  - リアルタイムな応答と、完全なカーソル・スクロール再現を目指す。

## 4. ネットワークとポートの運用

### ポートの使い分け
- **Docker 実行 (Production/Default):** ポート `3000` を使用。
- **ローカル実行 (Development/Debug):** ポート `4000` を使用 (`npm run dev`)。
  - テスト時に Docker ビルドを待たずにデバッグを行うための設定。

### tmux ソケットの指定
環境変数 `TMUX_SOCKET` を使用して、サーバーがアクセスする tmux ソケットを切り替える。
- **Docker コンテナ内:** `/tmp/tmux-1000/default` を明示的に指定。
- **ローカル環境:** 未指定（デフォルト）にすることで、ホスト上の標準的な tmux セッションを自動的に利用。

