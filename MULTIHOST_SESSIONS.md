# マルチホスト tmux セッションプール

## 概要

Work OS は複数ホスト上の tmux セッションを統一したダッシュボードで管理できるマルチホスト対応機能を備えています。

| 機能 | 説明 |
|------|------|
| **ローカルホスト** | Docker コンテナから bind-mount された `/tmp/tmux-1000/default` へのアクセス |
| **リモートホスト** | SSH 経由での WSL、別マシン上の tmux セッション管理 |
| **統一インターフェース** | すべてのセッションを同一ダッシュボードで監視・操作 |
| **複合セッションID** | `local:sessionname`, `wsl:sessionname` 形式で自動管理 |

---

## アーキテクチャ

### システム構成図

```
┌─────────────────────────────────────────────────────┐
│  ブラウザ (work.unlaxer.org)                       │
│  セッション一覧、ターミナル操作                      │
└─────────────────┬─────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────┐
│  Work OS (Docker コンテナ - HVU Local)             │
│  ┌──────────────────────────────────────────────┐  │
│  │ MultiHostSessionPool                         │  │
│  │  ├─ LocalTmuxProvider                        │  │
│  │  │  └─ /tmp/tmux-1000/default (bind-mount)  │  │
│  │  └─ SshTmuxProvider (設定時)                 │  │
│  │     └─ ssh opa@<WSL-IP>                     │  │
│  └──────────────────────────────────────────────┘  │
│  REST API (/api/sessions/*)                        │
│  WebSocket (Socket.IO - Terminal)                  │
└────┬──────────────────────┬─────────────────────────┘
     │                      │
     ▼                      ▼
┌─────────────────────┐ ┌──────────────────────────┐
│ ホスト tmux         │ │ WSL tmux (設定時)       │
│ (next-3.7)          │ │ ssh でアクセス           │
│ /tmp/tmux-1000/     │ │ /tmp/tmux-1000/default   │
│   default           │ │                          │
└─────────────────────┘ └──────────────────────────┘
```

### Provider インターフェース

```typescript
interface TmuxProvider {
  exec(args: string[]): string;        // tmux サブコマンド実行
  readonly socketPath: string | undefined;
  readonly hostId: string;              // "local", "wsl", etc.
  readonly displayName: string;         // "HVU Local", "WSL"
}
```

---

## セッション ID 仕様

### 複合 ID フォーマット

セッション ID は `hostId:sessionName` 形式で統一されます：

```
local:main          // ホスト上のセッション "main"
local:claude-2024   // ホスト上のセッション "claude-2024"
wsl:main            // WSL 上のセッション "main"
wsl:agent-work      // WSL 上のセッション "agent-work"
```

### 後方互換性

設定なし（デフォルト）の場合、すべてのセッションは自動的に `local:` プレフィックスが付きます。

---

## 環境変数設定

### WORK_OS_HOSTS

`docker-compose.yml` に以下を指定してマルチホスト機能を有効化します：

```yaml
environment:
  - WORK_OS_HOSTS=[
      {
        "hostId": "local",
        "displayName": "HVU Local",
        "type": "local"
      },
      {
        "hostId": "wsl",
        "displayName": "WSL (Windows)",
        "type": "ssh",
        "sshTarget": "opa@192.168.1.100",
        "socketPath": "/tmp/tmux-1000/default"
      }
    ]
```

### 設定パラメータ

| パラメータ | 型 | 説明 | 必須 |
|-----------|-----|------|------|
| `hostId` | string | ホスト識別子（複合IDの先頭部分） | ✓ |
| `displayName` | string | ダッシュボードに表示される名前 | ✓ |
| `type` | "local" \| "ssh" | プロバイダタイプ | ✓ |
| `sshTarget` | string | SSH接続先（`type: "ssh"` 時） | (ssh時) |
| `socketPath` | string | tmux ソケットパス（リモート側） | (ssh時) |

### SSH 接続オプション（デフォルト）

SshTmuxProvider は以下のオプションで SSH 接続を管理します：

```typescript
[
  '-o', 'BatchMode=yes',           // パスワード不要
  '-o', 'ConnectTimeout=5',        // 接続タイムアウト
  '-o', 'ControlMaster=auto',      // マスター接続再利用
  '-o', 'ControlPath=/tmp/ssh-wos-%r@%h:%p',
  '-o', 'ControlPersist=60'        // 接続を60秒保持
]
```

---

## API 仕様

### GET /api/sessions

全ホストのセッション一覧を取得

**レスポンス:**
```json
{
  "sessions": [
    {
      "id": "local:main",
      "name": "main",
      "hostId": "local",
      "hostName": "HVU Local",
      "isAttached": true,
      "created": 1710000000000,
      "command": "bash",
      "directory": "/home/opa",
      "currentCommand": "vim",
      "currentPath": "/home/opa/work/work-os",
      "clientCount": 1,
      "lastActivity": 1710000500000,
      "suggestedMode": "mirror"
    },
    {
      "id": "wsl:agent",
      "name": "agent",
      "hostId": "wsl",
      "hostName": "WSL (Windows)",
      "isAttached": false,
      "created": 1710000100000,
      "command": "claude",
      "directory": "/home/opa/work",
      "currentCommand": "node",
      "currentPath": "/home/opa/work",
      "clientCount": 0,
      "lastActivity": 1710000400000,
      "suggestedMode": "mirror"
    }
  ]
}
```

### POST /api/sessions

新しいセッションを作成

**リクエスト:**
```json
{
  "name": "claude-new",
  "command": "claude",
  "cwd": "/home/opa/work",
  "templateName": "standard-ja",
  "hostId": "local"
}
```

**レスポンス:**
```json
{
  "message": "Session claude-new started on HVU Local",
  "compositeId": "local:claude-new",
  "sessionName": "claude-new",
  "hostId": "local",
  "cwd": "/home/opa/work",
  "command": "claude",
  "instructionPath": "/tmp/workos-runtime/sessions/claude-new/AGENT.MD"
}
```

### GET /api/sessions/{id}

セッションのターミナル内容を取得

```
GET /api/sessions/local:main
GET /api/sessions/wsl:agent
```

**レスポンス:**
```json
{
  "id": "local:main",
  "content": "... terminal output ...",
  "isWaitingForInput": false,
  "lastLine": "$ ",
  "updatedAt": 1710000600000
}
```

### DELETE /api/sessions/{id}

セッションを終了

```bash
curl -X DELETE http://localhost:3000/api/sessions/local:main
curl -X DELETE http://localhost:3000/api/sessions/wsl:agent
```

### POST /api/sessions/{id}/send-key

セッションにキー入力を送信（mirror モード用）

```json
{
  "key": "C-c"
}
```

### POST /api/sessions/{id}/shell

セッションのディレクトリで新しいシェルセッションを開く

**レスポンス:**
```json
{
  "message": "Opened shell in /home/opa/work",
  "newSession": "sh-main-3a4b",
  "compositeId": "local:sh-main-3a4b",
  "cwd": "/home/opa/work"
}
```

### GET /api/sessions/{id}/clients

セッションに接続中のクライアント一覧

```json
{
  "sessionId": "local:main",
  "clients": [
    {
      "name": "0",
      "pid": 1234,
      "tty": "/dev/pts/0",
      "size": "120x32",
      "created": 1710000000000,
      "activity": 1710000500000,
      "termname": "xterm-256color"
    }
  ]
}
```

---

## UI / ダッシュボード仕様

### ホスト別グループ表示

ダッシュボードのセッション一覧は自動的にホスト別に分類されます：

```
─ HVU Local
  main (claude)           ● active   Clients: 1
  work-os (node dev)      ○ idle     Clients: 0

─ WSL (Windows)
  agent (claude)          ○ idle     Clients: 0
  claude-2024             ● active   Clients: 2
```

### セッションカード

各セッションは以下の情報を表示：

| 要素 | 説明 |
|------|------|
| セッション名 | `hostId:name` 形式のID |
| Mode | pty（PTY モード）/ mirror（ミラーモード） |
| Status | Active / Idle / INPUT WAITING |
| Clients | 接続中のクライアント数 |
| CWD | 現在のディレクトリ |
| Cmd | 現在実行中のコマンド |
| Terminal | リアルタイムターミナル表示 |

### ターミナルモード

| モード | 説明 | 用途 |
|-------|------|------|
| **pty** | PTY 接続（コマンド実行・制御） | バッシュセッションやシェル操作 |
| **mirror** | 読み取り専用ミラー | エージェント実行の監視 |
| **readonly-mirror** | 読み取り専用（明示指定） | 操作禁止の監視モード |
| **attach** | Attach セッション | TMux クライアント接続 |
| **resize-client** | ウィンドウリサイズ対応 | ウィンドウサイズ変更対応 |

---

## 使い方

### セットアップ

#### 1. Docker コンテナのビルド・起動

```bash
cd /home/opa/work/work-os
docker-compose -f ~/work/aerie-platform/services/work-os/compose.yml down
docker-compose -f ~/work/aerie-platform/services/work-os/compose.yml up -d
```

#### 2. ホストのtmux確認

```bash
# ホスト上の tmux バージョン確認
tmux -V
# → tmux next-3.7

# コンテナで確認
docker exec work-os-app tmux -V
# → tmux next-3.7（バージョン一致 ✓）

# セッション一覧確認
docker exec work-os-app tmux -S /tmp/tmux-1000/default ls
```

#### 3. WSL セッション統合（オプション）

**docker-compose.yml を編集:**

```yaml
services:
  app:
    environment:
      - WORK_OS_HOSTS=[
          {
            "hostId": "local",
            "displayName": "HVU Local",
            "type": "local"
          },
          {
            "hostId": "wsl",
            "displayName": "WSL (Windows)",
            "type": "ssh",
            "sshTarget": "opa@172.31.128.1",
            "socketPath": "/tmp/tmux-1000/default"
          }
        ]
    volumes:
      - /home/opa/.ssh:/root/.ssh:ro
```

**WSL 側の準備:**

```bash
# WSL でtmuxソケットディレクトリ作成
mkdir -p /tmp/tmux-1000

# SSH キー認証でログイン可能か確認
ssh -o BatchMode=yes opa@172.31.128.1 tmux ls
```

### ダッシュボード操作

#### セッション作成

1. "エージェントを起動" フォームで以下を入力：
   - **セッション名**: `claude-work`
   - **コマンド**: `claude`
   - **ディレクトリ**: `/home/opa/work`
   - **性格**: `standard-ja`

2. **起動** ボタン をクリック

3. セッション一覧に `local:claude-work` が追加される

#### セッション監視

- **司令塔** セクションですべてのセッションのサマリーを確認
- **セッションカード** でターミナル出力をリアルタイム表示
- **Auto-Yes** チェックボックスで定型プロンプト自動処理

#### ターミナル操作

**キー送信:**
```javascript
// mirror モード での手動操作
await fetch(`/api/sessions/local:main/send-key`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ key: 'C-c' })
});
```

**シェル開く:**
```javascript
// 同じディレクトリで別シェル開く
const res = await fetch(`/api/sessions/local:main/shell`, {
  method: 'POST'
});
const data = await res.json();
console.log(data.compositeId);  // → "local:sh-main-3a4b"
```

---

## トラブルシューティング

### 問題: コンテナから tmux がコマンド不見つからず

**原因:** Dockerfile からホストバイナリをマウントするように修正されていない

**対策:**
```bash
# Dockerfile で以下のビルド行が削除されているか確認
grep -i "git clone.*tmux.git" Dockerfile
# 結果が空なら OK

# 再ビルド
docker-compose -f ~/work/aerie-platform/services/work-os/compose.yml build --no-cache
```

### 問題: バージョン不一致エラー

```
error connecting to /tmp/tmux-1000/default: protocol version mismatch (client 1, server 2)
```

**原因:** コンテナと ホスト の tmux バージョンが異なる

**対策:**
```bash
# ホストバイナリがマウントされているか確認
docker exec work-os-app ls -la /usr/local/bin/tmux

# バージョン確認
docker exec work-os-app tmux -V
tmux -V  # ホスト側

# 一致しない場合は docker-compose.yml でマウント確認
```

### 問題: WSL SSH 接続がタイムアウト

```
ssh: connect to host 172.31.128.1 port 22: Connection timed out
```

**原因:**
- WSL の IP アドレスが異なる
- SSH が WSL で起動していない
- ファイアウォール設定

**対策:**
```bash
# WSL の IP 確認
wsl hostname -I

# コンテナから SSH 疎通確認
docker exec work-os-app ssh -o ConnectTimeout=5 opa@<WSL-IP> 'tmux -V'

# SSH キー認証設定
docker exec work-os-app ssh-copy-id -i /root/.ssh/id_rsa.pub opa@<WSL-IP>
```

### 問題: API で「host not found」エラー

```json
{ "error": "host not found: wsl" }
```

**原因:** `WORK_OS_HOSTS` 環境変数の JSON パースエラー

**対策:**
```bash
# 環境変数の形式を確認
docker exec work-os-app env | grep WORK_OS_HOSTS

# JSON の有効性をチェック
echo '[{"hostId":"local",...}]' | jq .

# docker-compose.yml で改行を削除し1行で記述
```

---

## 実装詳細

### ファイル構成

```
src/
├── lib/
│   └── tmux-provider.ts
│       ├── TmuxProvider (interface)
│       ├── DefaultSocketProvider
│       ├── ExplicitSocketProvider
│       ├── SshTmuxProvider (New)
│       ├── MultiHostSessionPool (New)
│       └── buildSessionPool() (New)
├── app/
│   ├── api/
│   │   └── sessions/
│   │       ├── route.ts (Updated)
│   │       ├── [id]/
│   │       │   ├── route.ts (Updated)
│   │       │   ├── send-key/route.ts (Updated)
│   │       │   ├── shell/route.ts (Updated)
│   │       │   └── clients/route.ts (Updated)
│   ├── page.tsx (Updated - host grouping)
├── server.ts (Updated)
│   ├── getSessionInfo() → takes provider
│   ├── sendMirrorData() → uses provider.exec()
│   ├── ensurePtyBridge() → SSH support
│   └── bridges キー → composite ID
```

### 後方互換性

- `resolveTmuxProvider()` は従来通り利用可能
- 既存コードとの互換性を維持
- デフォルト（設定なし）で `local:` プレフィックスが自動付与

---

## 今後の拡張

- [ ] 複数 SSH ホストの並列管理
- [ ] ホスト別の接続状態表示
- [ ] SSH キーペア自動交換
- [ ] ホスト冗長化・フェイルオーバー
- [ ] Web UI でのホスト追加・削除機能

