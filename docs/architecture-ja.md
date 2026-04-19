[English version](architecture.md)

# アーキテクチャ

work-os は**ハイブリッドコントロールプレーン**です。Web UI は Docker で動き、エージェントはホスト（またはリモートマシン）の tmux で動きます。両者は共有 tmux ソケットまたは SSH/HTTP 経由で通信します。

---

## 全体構成

```
ブラウザ
  │  HTTP（Next.js ページ + API ルート）
  │  WebSocket（Socket.IO — ターミナルストリーム）
  ▼
┌──────────────────────────────────────────┐
│  work-os プロセス（Docker またはローカル）  │
│                                          │
│  Next.js 16（App Router）                │
│    └─ src/app/api/**   REST エンドポイント │
│                                          │
│  Express 5（src/server.ts）              │
│    └─ Socket.IO 4      WS サーバー        │
│    └─ /healthz         ヘルスチェック     │
│                                          │
│  MultiHostSessionPool                    │
│    ├─ LocalTmuxProvider   （ソケット）    │
│    ├─ SshTmuxProvider     （ssh）        │
│    └─ HttpRemoteProvider  （http）       │
└──────────┬──────────────────────────┬───┘
           │ ソケット bind-mount / SSH  │ HTTP REST
           ▼                          ▼
     ホスト tmux                  リモートエージェント
     /tmp/tmux-1000/default      :3001/api/sessions
```

---

## コンポーネントの責務

### Next.js 16（App Router）

- ダッシュボード SPA を提供（`src/app/page.tsx`）
- `src/app/api/sessions/` 配下に REST API ルートを公開
  - `GET /api/sessions` — 全ホストのセッション一覧
  - `POST /api/sessions` — 新しい tmux セッションを作成
  - `GET /api/sessions/:id` — セッションメタデータを取得
  - `DELETE /api/sessions/:id` — セッションを終了
  - `POST /api/sessions/:id/send-key` — セッションにキーを送信
  - `POST /api/sessions/:id/shell` — 同一ディレクトリで子シェルを開く
  - `GET /api/sessions/:id/clients` — tmux クライアント一覧
  - `POST /api/sessions/:id/auto-accept` — Commander の自動承認を有効化
- すべてのルートは**認証なし**（[security-ja.md](security-ja.md) 参照）

### Express 5（`src/server.ts`）

- Next.js リクエストハンドラー（`app.getRequestHandler()`）をラップ
- 同一 HTTP サーバー上に Socket.IO をマウント
- `bridges` Map を管理 — 複合セッション ID をキーとしたライブターミナル接続
- `socketToSession` Map を管理 — Socket.IO のソケット ID からブリッジキーへのマッピング
- `/healthz` エンドポイントでモード別ブリッジ数を返す

### Socket.IO 4 — WebSocket トランスポート

自動再接続とトランスポートフォールバックのため WebSocket ではなく Socket.IO を使用。パスは `/socket.io`。

**クライアント → サーバー イベント**:

| イベント | ペイロード | 効果 |
|---|---|---|
| `start` | `{ sessionId, cols, rows, preferredMode }` | ブリッジをアタッチまたは作成 |
| `command` | `{ data }` | キーストロークをブリッジに転送 |
| `resize` | `{ cols, rows }` | PTY または tmux ウィンドウをリサイズ |

**サーバー → クライアント イベント**:

| イベント | ペイロード | 意味 |
|---|---|---|
| `terminal:status` | `{ state, sessionId, message, readOnly }` | 接続準備完了 / エラー |
| `output` | string | 生のターミナルバイト（PTY モード） |
| `terminal:snapshot` | `{ sessionId, data }` | 全画面キャプチャ（mirror モード） |
| `terminal:error` | `{ sessionId, message }` | ブリッジからのエラー |
| `session-exit` | `{ sessionId, exitCode, signal }` | PTY プロセスが終了 |

CORS は `origin: true`（全オリジンを受け入れ）に設定されています。ローカル / Docker 利用では意図的な設定ですが、**オリジンを強制するフロントエンドプロキシなしにパブリック公開してはなりません**。

### MultiHostSessionPool（`src/lib/tmux-provider.ts`）

`hostId → TmuxProvider` のマップを管理。複合セッション ID は `hostId:sessionName` 形式。

**プロバイダーの種類**:

| 種別 | クラス | トランスポート |
|---|---|---|
| `local` | `DefaultSocketProvider` / `ExplicitSocketProvider` | `execFileSync('tmux', ...)` |
| `ssh` | `SshTmuxProvider` | `execFileSync('ssh', [..., 'tmux', ...])` |
| `http` | `HttpRemoteProvider` | `execFileSync('curl', ...)` → HTTP |

SSH は ControlMaster 多重化（`ControlPersist=60s`）を使用して接続オーバーヘッドを分散。

### WS ストリーミング — ブリッジの種類

`server.ts` に 3 種類のブリッジが存在します:

**`PtyBridge`**（モード: `pty`）
- `node-pty` を起動 → `tmux attach-session -t <session>`（ローカル）または `ssh -t <host> tmux attach-session`（リモート SSH）
- 生の PTY バイトを `output` イベントで全購読ソケットにストリーミング
- リサイズ: `ptyProcess.resize(cols, rows)` + `resize-client` モードでは `tmux resize-window` も実行
- ライフタイム: 全ソケットがデタッチするまで維持

**`MirrorBridge`**（モード: `mirror`）
- 400ms ごとに `tmux capture-pane -a -e -J -p -t <session>` をポーリング
- キャプチャ文字列が変化した場合のみ `terminal:snapshot` を送信
- 入力: 受信キーコード（矢印、Enter、Backspace、Tab、Ctrl-C）を `tmux send-keys` 呼び出しに変換
- `readonly-mirror` モードでは `readOnly: true` — 入力はサイレントに破棄
- ライフタイム: 最後のソケットがデタッチすると破棄

**`RemoteWebSocketBridge`**（モード: `remote-websocket`）
- HTTP エージェントの Socket.IO サーバーへの Socket.IO クライアント接続を開く
- `output`、`session-exit`、`terminal:error`、`terminal:status` イベントを双方向プロキシ
- プロバイダーが `HttpRemoteProvider` の場合に使用

### Commander Agent（`src/lib/auto-accept.ts` + `src/lib/session-store.ts`）

`SessionStore` はメモリ内の commander↔target マッピングを保持。

`AutoAcceptManager` はアクティブな commander ごとに `setInterval`（5 秒）を実行:
1. `capture-pane` でターゲットセッションをキャプチャ
2. 最後の 1〜2 行でプロンプトパターンを確認: `y/n`、`[Yy]/[Nn]`、`\d+\. `、`●`、`?$`、シェルプロンプト `[$#>]`
3. プロンプト検出時はキーを決定: 番号付き "Allow/Yes" メニューには `1\n`、それ以外は `y\n`
4. `tmux send-keys` でキーを送信

**ホワイトリストはありません。** パターンに一致するセッションはすべて自動応答を受け取ります。

---

## データフロー: セッション一覧

```
ブラウザ GET /api/sessions
  → Next.js ルートハンドラー
    → sessionPool.listAll()
      → 各プロバイダーで: provider.exec(['ls', '-F', <format>])
        local: execFileSync('tmux', ...)
        ssh:   execFileSync('ssh', [..., 'tmux', ...])
        http:  execFileSync('curl', ...) → エージェントの /api/sessions
      → __WORKOS__ 区切り行をパース
    → 結果をマージ、ホストメタデータを付与
  → JSON レスポンス
```

## データフロー: ターミナルセッション

```
ブラウザがソケット 'start' を emit { sessionId: "local:main", cols: 220, rows: 50 }
  → server.ts ソケットハンドラー
    → sessionPool.resolve("local:main") → { provider: LocalProvider, sessionName: "main" }
    → getSessionInfo(provider, "main", preferredMode) → { mode: "pty"|"mirror", ... }
    → ensurePtyBridge() または ensureMirrorBridge()
      PtyBridge: pty.spawn('tmux', ['attach-session', '-t', 'main'])
      MirrorBridge: setInterval(captureSession, 400)
    → bridge.sockets.add(socket.id)
    → 'terminal:status' { state: 'ready' } を emit
    → [mirror] 初期コンテンツとともに 'terminal:snapshot' を emit

ブラウザがソケット 'command' を emit { data: "ls\r" }
  → bridge.mode === 'pty': ptyProcess.write(data)
  → bridge.mode === 'mirror': sendMirrorData(provider, sessionName, data)
```

---

## ファイルマップ

```
src/
├── server.ts                    Express 5 + Socket.IO サーバー + ブリッジロジック
├── lib/
│   ├── tmux-provider.ts         TmuxProvider インターフェース + 全プロバイダー実装
│   │                            MultiHostSessionPool、buildSessionPool()
│   ├── auto-accept.ts           AutoAcceptManager — Commander Agent ポーリング
│   └── session-store.ts         SessionStore — commander↔target メタデータ
├── app/
│   ├── page.tsx                 ダッシュボード SPA
│   ├── layout.tsx               ルートレイアウト
│   └── api/sessions/
│       ├── route.ts             GET（一覧）/ POST（作成）
│       └── [id]/
│           ├── route.ts         GET（メタデータ）/ DELETE（終了）
│           ├── send-key/        POST キー送信
│           ├── shell/           POST 子シェル起動
│           ├── clients/         GET tmux クライアント一覧
│           └── auto-accept/     POST 有効化 / DELETE 無効化
├── components/
│   └── Terminal.tsx             xterm.js ラッパー + Socket.IO クライアント
next.config.js                   有効な Next.js 設定（module.exports）
next.config.ts                   STUB — 無効、削除すべき
```

---

## 既知のアーキテクチャ上の制限

| 問題 | 影響 | 対策 |
|---|---|---|
| 認証なし | ネットワーク到達可能なクライアントがセッションを読み書き可能 | Cloudflare Tunnel + Access の背後に配置、またはローカルのみで運用 |
| `cors: origin: true` | Socket.IO が任意のオリジンからの接続を受け入れ | 同上 |
| `next.config.js` / `.ts` 重複 | どちらの設定が有効か混乱を招く可能性 | `next.config.ts` を削除 |
| Commander Agent にホワイトリストなし | リンクされたセッションの任意のプロンプトに自動応答 | 信頼済みセッションにのみ使用 |
| Mirror モード 400ms ポーリング | わずかな遅延、`capture-pane` からカーソル位置取得不可 | インタラクティブセッションには PTY モードを使用 |
| HTTP エージェントに認証なし | エージェントの REST エンドポイントが開放 | ファイアウォール / プライベートネットワーク内に配置 |
