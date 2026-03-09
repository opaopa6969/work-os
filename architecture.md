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
- Docker コンテナにホストの `tmux` ソケット（`/tmp/tmux-1000/`）を読み取り専用、または操作用としてマウントする。
- `tmux` コマンドを通じて、コンテナ外（ホスト側）のセッションを操作・キャプチャする。
