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

### 環境ベースの設定（`.env` ファイル）

**重要:** より詳細な設定方法については [`services/work-os/CONFIGURATION.md`](./services/work-os/CONFIGURATION.md) を参照してください。

複数環境での動作を容易にするため、work-os は環境変数ベースの設定をサポートしています。

#### 簡単セットアップ

```bash
cd services/work-os
cp .env.example .env
# .env を自分の環境に合わせて編集
docker-compose up
```

#### .env ファイル例

```ini
# HVU ホスト設定
HVU_HOST_ID=hvu
HVU_DISPLAY_NAME=HVU (Host)
HVU_SSH_TARGET=opa@192.168.1.50
HVU_SOCKET_PATH=/tmp/tmux-1000/default

# WSL ホスト設定
WSL_HOST_ID=wsl
WSL_DISPLAY_NAME=WSL
WSL_SSH_TARGET=opa@172.29.214.157
WSL_SOCKET_PATH=/tmp/tmux-1000/default

# ボリュームマウントパス
WORK_OS_SOURCE_PATH=/home/opa/work/work-os
SSH_KEY_PATH=/root/.ssh
```

#### 利点

- **ポータビリティ**: IP アドレス、ユーザー名などをハードコードしないため、異なる環境で使用可能
- **セキュリティ**: SSH 鍵、パスなどを`.env` ファイル（Git ignore）に保管可能
- **柔軟性**: 環境変数で複数ホスト構成を管理

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

##### Step 1: SSH キー認証設定

HVU コンテナで ED25519 キーペアを生成：

```bash
docker exec work-os bash -c '
ssh-keygen -t ed25519 -f /root/.ssh/id_ed25519 -N ""
cat /root/.ssh/id_ed25519.pub
'
```

出力された公開キーを WSL の `~/.ssh/authorized_keys` に追加：

```bash
# WSL側で実行
mkdir -p ~/.ssh
echo "ssh-ed25519 AAAAC3NzaC1..." >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
chmod 700 ~/.ssh
```

##### Step 2: Windows WSL 設定

Windows ホストで `.wslconfig` を編集：

```powershell
# PowerShell で実行
notepad $env:USERPROFILE\.wslconfig
```

以下を追加：

```ini
[interop]
localhostForwarding=false
```

保存後、WSL を再起動：

```powershell
wsl --shutdown
```

この設定により、WSL のポート（SSH 22 など）が Windows ホストのネットワークインターフェースに公開されます。

##### Step 3: `.env` ファイルを設定

`services/work-os/.env` ファイルを作成し、ホスト情報を設定：

```bash
cd services/work-os
cp .env.example .env
```

`.env` を編集して、自分の環境に合わせます：

```ini
# HVU設定（ローカルホスト）
HVU_HOST_ID=hvu
HVU_DISPLAY_NAME=HVU (Host)
HVU_SSH_TARGET=opa@192.168.1.50
HVU_SOCKET_PATH=/tmp/tmux-1000/default

# WSL設定（リモートホスト）
WSL_HOST_ID=wsl
WSL_DISPLAY_NAME=WSL
WSL_SSH_TARGET=opa@172.29.214.157
WSL_SOCKET_PATH=/tmp/tmux-1000/default

# ボリュームマウント設定
WORK_OS_SOURCE_PATH=/home/opa/work/work-os
SSH_KEY_PATH=/root/.ssh
```

`docker-compose.yml` は環境変数を自動的に読み込むため、追加の編集は不要です。

##### Step 4: WSL 側の確認

```bash
# SSH サーバー起動確認
sudo systemctl status ssh

# tmux セッション確認
tmux -S /tmp/tmux-1000/default ls
```

##### Step 5: 接続テスト

```bash
# HVU側で実行
ssh opa@192.168.1.50 "docker exec work-os ssh opa@172.29.214.157 'tmux -S /tmp/tmux-1000/default ls'"
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
ssh: connect to host 172.29.214.157 port 22: Connection timed out
```

**原因:**
1. WSL ポートが Windows ホストネットワークに公開されていない
2. WSL `.wslconfig` の `localhostForwarding=false` 設定がない
3. WSL が再起動されていない

**対策:**

**A) Windows .wslconfig を確認・編集**

```powershell
# .wslconfig の内容確認
type $env:USERPROFILE\.wslconfig

# [interop] セクションに以下が含まれているか確認
# [interop]
# localhostForwarding=false

# ない場合は追加してファイルを保存
```

**B) WSL を再起動**

```powershell
# PowerShell で実行
wsl --shutdown

# WSL を再起動（WSLのセッションが終わった後）
wsl
```

**C) WSL IP アドレス確認**

```bash
# WSL側で実行
hostname -I
# 出力例: 172.29.214.157 192.168.1.50

# HVU側で確認
ssh opa@192.168.1.50 "ping -c 1 172.29.214.157"
```

**D) ルーティング確認**

```bash
# HVU側で実行
ssh opa@192.168.1.50 "ip route | grep 172"
# 172.29.0.0 へのルートが表示されるか確認
```

**E) SSH キー認証確認**

```bash
# HVU側で実行
ssh opa@192.168.1.50 "cat /root/.ssh/id_ed25519.pub"

# WSL側で確認
cat ~/.ssh/authorized_keys | grep "id_ed25519"
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

## Session 5 実装更新（WSL 統合完全対応）

### 変更履歴

#### SSH コマンド実行の修正

**問題:** execFileSync で複数の SSH オプションを渡すと、bash -c への引数がトークンで分割されていた

**修正内容:**
```typescript
// 変更前（失敗）
const cmd = ['ssh', ...sshOpts, sshTarget, 'bash', '-c', `TERM=xterm ${bashCmd}`];

// 変更後（成功）- リモートコマンドを単一文字列として渡す
const remoteCmd = `bash -c "TERM=xterm ${tmuxArgs}"`;
const cmd = ['ssh', ...sshOpts, sshTarget, remoteCmd];
```

**影響:** HVU と WSL の両ホストから正常に tmux コマンドが実行可能に

#### セッション接続の改善

1. **複合 ID パース:** `hvu:aerie-platform` の形式を保持し、`:` を削除しないように修正
2. **SSH PTY 作業ディレクトリ:** リモートパスではなくコンテナ内の有効なパスを使用
3. **SSH 設定:** `StrictHostKeyChecking=accept-new` で未知ホストの自動受け入れ

#### Docker SSH 設定

```
Host *
  StrictHostKeyChecking accept-new
  BatchMode yes
  ConnectTimeout 5
  ServerAliveInterval 5
  ServerAliveCountMax 2

Host 172.29.214.157
  ConnectTimeout 2
  ServerAliveInterval 1
  ServerAliveCountMax 1
```

### 対応バージョン

- work-os: v0.1.19+
- Node: 20.x
- TypeScript: 5.x

---

## セキュリティ考慮事項

### 認証方式の比較

| 方式 | セキュリティ | 実装コスト | 複雑性 | 推奨シーン |
|------|-----------|---------|-------|---------|
| **SSH キー認証** | ✅ 高（デフォルト） | 中 | 中 | **本番環境（現在）** |
| **REST API + API Key** | ⚠️ 中（設定が必須） | 高 | 高 | 単一ホスト管理 |
| **REST API + JWT** | ✅ 高 | 高 | 高 | 複数ホスト（将来） |
| **REST API + mTLS** | ✅ 高 | 最高 | 最高 | 高セキュリティ要件 |
| **Agent（認証なし）** | ❌ 低 | 低 | 低 | 開発環境のみ |

### 現在の SSH ベース実装（推奨）

**メリット：**
- SSH の認証・暗号化がデフォルトで有効
- 追加のセキュリティ設定が不要
- ホスト検証が組み込まれている

**セキュリティ強化設定：**

```typescript
class SecureSshTmuxProvider implements TmuxProvider {
  private readonly sshOpts = [
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=5',
    '-o', 'IdentitiesOnly=yes',        // 認証済みキーのみ使用
    '-o', 'PreferredAuthentications=publickey', // 公開キー認証のみ
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'UserKnownHostsFile=/root/.ssh/known_hosts',
    '-o', 'ControlMaster=auto',
    '-o', 'ControlPath=/tmp/ssh-wos-%r@%h:%p',
    '-o', 'ControlPersist=60'
  ];
}
```

---

## REST API アーキテクチャ（将来の参考）

### 代替案：ホスト Agent パターン

各サーバーで小型 HTTP サーバー（Agent）を運用：

```
work-os (Docker)
  ├─ HTTP/REST → HVU Agent (192.168.1.50:3001)
  ├─ HTTP/REST → WSL Agent (172.29.214.157:3001)
  └─ HTTP/REST → その他サーバー Agent
```

### REST API エンドポイント案

```typescript
// セッション管理
GET    /tmux/sessions              // セッション一覧
POST   /tmux/sessions              // 新規作成
GET    /tmux/sessions/{id}         // 詳細取得
DELETE /tmux/sessions/{id}         // 終了

// ターミナル操作
GET    /tmux/sessions/{id}/output  // 出力取得
POST   /tmux/sessions/{id}/send-key   // キー送信
POST   /tmux/sessions/{id}/send-text  // テキスト送信
WS     /tmux/sessions/{id}/stream  // リアルタイムストリーム
```

### セキュアな実装例

```typescript
// API Key 認証
app.use((req, res, next) => {
  const key = req.headers['x-api-key'];
  if (key !== process.env.AGENT_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

// JWT 認証
const token = jwt.sign({ host: 'hvu', iat: Date.now() },
  process.env.JWT_SECRET,
  { expiresIn: '1h' }
);

// HTTPS + mTLS（最高セキュリティ）
const tlsOptions = {
  key: fs.readFileSync('/etc/agent/private.key'),
  cert: fs.readFileSync('/etc/agent/certificate.pem'),
  ca: fs.readFileSync('/etc/agent/ca.pem'),
  requestCert: true,
  rejectUnauthorized: true
};

https.createServer(tlsOptions, app).listen(3001);
```

### メリット/デメリット

**REST API メリット：**
- 言語非依存（任意の言語で Agent を実装可能）
- スケーラブル（サーバー追加が容易）
- API バージョニング可能
- HTTP キャッシング活用可

**REST API デメリット：**
- 認証・暗号化の実装が必須
- ネットワーク遅延が増加
- 認証情報管理の複雑さ

---

## 実装ロードマップ

### Phase 1: SSH ベース（現在 ✅）
- HVU → WSL 接続完全対応
- SSH キー認証
- 複合 ID による複数ホスト管理

### Phase 2: REST API（オプション、複数ホスト時）
- 複数リモートサーバー対応時に検討
- JWT 認証実装
- API ゲートウェイ導入

### Phase 3: mTLS（エンタープライズ対応）
- 証明書ベース認証
- 相互 TLS
- 監査ログ

---

## 今後の拡張

- [ ] 複数 SSH ホストの並列管理
- [ ] ホスト別の接続状態表示
- [ ] SSH キーペア自動交換
- [ ] ホスト冗長化・フェイルオーバー
- [ ] Web UI でのホスト追加・削除機能
- [ ] REST API オプション実装（Phase 2）
- [ ] 監査ログ機能

