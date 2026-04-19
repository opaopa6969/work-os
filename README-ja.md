[English version](README.md)

# work-os

ブラウザベースの tmux 操作コンソール — **Next.js 16 + Express 5 + Socket.IO。**

複数の tmux セッションを 1 つのダッシュボードで監視・操作します。複数ホスト（SSH、HTTP エージェント）のセッションを集約し、WebSocket 経由でターミナル出力をストリーミング、Commander Agent によりエージェントプロンプトへの自動応答も可能です。

> **work-os** = tmux で動く AI エージェントたちのための操作画面。タブ 1 つですべてが見える。

**ドキュメント**: [アーキテクチャ](docs/architecture-ja.md) | [Getting Started](docs/getting-started-ja.md) | [セキュリティ](docs/security-ja.md)

**English**: [Architecture](docs/architecture.md) | [Getting Started](docs/getting-started.md) | [Security](docs/security.md)

---

> **セキュリティ警告** — work-os は**認証機能を持ちません**。API は完全に開放されており、Socket.IO には `cors: { origin: true }` が設定されています。追加の保護（例: Cloudflare Tunnel + Access）なしにインターネットへ公開しないでください。詳細は [docs/security-ja.md](docs/security-ja.md) を参照。

---

## 目次

- [できること](#できること)
- [スタック](#スタック)
- [クイックスタート](#クイックスタート)
- [マルチホスト設定](#マルチホスト設定)
- [Commander Agent](#commander-agent)
- [ターミナルモード](#ターミナルモード)
- [既知の問題](#既知の問題)

---

## できること

- 複数の tmux セッションを 1 つのダッシュボードで監視
- Socket.IO 経由でターミナル出力をライブストリーミング（PTY attach または mirror capture）
- ローカル・SSH リモート・HTTP エージェントブリッジによる複数ホストのセッション集約
- セッションを作成日時・アクティビティ・名前でソート
- コマンド・作業ディレクトリ・テンプレートを指定して新しいエージェントセッションを起動
- 同じ作業ディレクトリで子シェルセッションを追加起動
- セッションごとの tmux クライアント一覧表示・切断
- **Commander Agent**: ターゲットセッションの `y/n` や番号選択プロンプトに自動応答する自律セッションをアタッチ

---

## スタック

| レイヤー | 技術 |
|---|---|
| フロントエンド | Next.js 16（App Router）+ React 19 |
| バックエンド | Express 5 カスタムサーバー（`src/server.ts`） |
| リアルタイム | HTTP 上の Socket.IO 4 |
| ターミナル描画 | xterm.js 5 + fit addon |
| PTY ブリッジ | node-pty |
| マルチプレクサー | ホスト tmux（ソケット bind-mount または SSH） |
| マルチホスト | `MultiHostSessionPool` — local / SSH / HTTP プロバイダー |

> **注意**: リポジトリには `next.config.js` と `next.config.ts` の両方が存在します。`next.config.js`（`module.exports`）が有効な設定ファイルです。`next.config.ts` はスキャフォールド生成時の stub であり実質的に無効です。混乱を避けるためこの重複は削除すべきです。

---

## クイックスタート

### ローカル開発

```bash
cd /home/opa/work/work-os
npm install
PORT=4311 npm run dev
```

`http://127.0.0.1:4311` を開きます。

### Docker

```bash
cd /home/opa/work/work-os
docker compose up -d --build
```

`http://127.0.0.1:3000` を開きます。

Docker コンテナの bind-mount 構成:

| コンテナパス | ホストパス | 目的 |
|---|---|---|
| `/usr/local/bin/tmux` | ホスト tmux バイナリ | バージョン一致 |
| `/tmp/tmux-1000` | ホスト tmux ソケットディレクトリ | ソケットアクセス |
| `/app/src` | `./src` | ライブコードリロード |
| `/app/public` | `./public` | 静的アセット |
| `/app/templates` | `./templates` | セッションテンプレート |

コンテナは独立した tmux サーバーを起動**しません** — ホストのソケットに接続します。コンテナを停止しても tmux セッションは終了しません。

---

## マルチホスト設定

work-os は複数ホストのセッションを集約できます。`WORK_OS_HOSTS` 環境変数（JSON 配列）で設定します:

```yaml
# docker-compose.yml
environment:
  WORK_OS_HOSTS: |
    [
      { "hostId": "local", "displayName": "Local", "type": "local" },
      { "hostId": "wsl",   "displayName": "WSL",   "type": "ssh",
        "sshTarget": "opa@172.29.214.157",
        "socketPath": "/tmp/tmux-1000/default" },
      { "hostId": "rpi",   "displayName": "Pi",    "type": "http",
        "agentUrl": "http://192.168.1.80:3001" }
    ]
```

セッション ID は `hostId:sessionName` 形式になります（例: `wsl:claude-work`）。

完全なセットアップ手順は [docs/getting-started-ja.md](docs/getting-started-ja.md) を参照してください。

---

## Commander Agent

Commander Agent はターゲットセッションに自律セッションをアタッチし、プロンプトへ自動応答します。

1. セッションカードの **[⚔️ 司令官を追加]** をクリック。
2. 司令官の名前を入力し、必要に応じてテンプレートを選択。
3. **起動** をクリック。

司令官は 5 秒ごとにターゲットをポーリングします。`y/n` プロンプト、番号選択、またはシェルプロンプトを検出すると、適切なキーを送信します。

**割込み**: 司令官セッションに何か入力すると、30 秒間自動応答が一時停止します。

> **警告** — Commander Agent には入力ホワイトリストがありません。ターゲットセッションの任意のプロンプトパターンに自動応答します（破壊的なコマンドも含む）。完全に管理下にあるセッションにのみ使用してください。詳細は [docs/security-ja.md](docs/security-ja.md) を参照。

使用例:
- 長時間の Claude Code 実行中のファイル編集確認を自動承認
- CI/CD ワークフローのルーチンな `y/n` プロンプト処理

---

## ターミナルモード

| モード | 説明 | 適した用途 |
|---|---|---|
| `auto` | work-os が attach/mirror を自動選択 | デフォルト |
| `attach` | tmux への live PTY attach | シェルセッション |
| `resize-client` | PTY attach + ウィンドウリサイズ同期 | サイズ同期が必要なシェル |
| `mirror` | `capture-pane` による 400ms ポーリング | エージェント / TUI セッション |
| `readonly-mirror` | 入力無効の mirror | 読み取り専用の観察 |

Mirror モードは、セッションが他所でアタッチ済みの場合に安全です。PTY モードはインタラクティブシェルで低レイテンシを提供します。

---

## 既知の問題

- **`next.config.js` / `next.config.ts` の重複** — 両ファイルが存在。`next.config.js` が有効。`.ts` stub は削除すべき。
- **認証なし** — すべての API エンドポイントと Socket.IO 接続は認証されていません。[docs/security-ja.md](docs/security-ja.md) を参照。
- **Commander Agent のホワイトリスト未実装** — エージェントは一致するプロンプトパターンすべてに応答します。セッション単位の許可リストはありません。
- **Mirror モードのカーソル** — `capture-pane` 出力はカーソル位置を保持しないため、複雑な TUI のカーソル描画がずれる場合があります。
