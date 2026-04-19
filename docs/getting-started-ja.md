[English version](getting-started.md)

# Getting Started

初期セットアップとマルチホスト設定の手順です。

---

## 前提条件

- Node.js 20 以上
- ホストマシンに tmux がインストール済み
- （Docker モードの場合）Docker + Docker Compose

---

## ローカル開発

### 1. 依存関係のインストール

```bash
cd /home/opa/work/work-os
npm install
```

### 2. サーバーの起動

```bash
PORT=4311 npm run dev
```

`dev` スクリプトは `ts-node --project tsconfig.server.json src/server.ts` を実行し、Express 5 + Socket.IO を起動してから Next.js を開発モードで起動します。

### 3. ダッシュボードを開く

```
http://127.0.0.1:4311
```

work-os はローカルの tmux ソケットを以下の順で自動検出します:
1. `TMUX_SOCKET` 環境変数（明示的指定）
2. デフォルト tmux ソケット（通常 `/tmp/tmux-<uid>/default`）
3. 共通パス: `/tmp/tmux-1000/default`、`/tmp/tmux-0/default`

---

## Docker

### 1. 起動

```bash
cd /home/opa/work/work-os
docker compose up -d --build
```

### 2. ダッシュボードを開く

```
http://127.0.0.1:3000
```

### 3. 必要な bind-mount

コンテナはホストの tmux ソケットにアクセスする必要があります。`docker-compose.yml` には以下が含まれています:

```yaml
volumes:
  - /usr/local/bin/tmux:/usr/local/bin/tmux:ro   # バージョン一致
  - /tmp/tmux-1000:/tmp/tmux-1000                # ソケットディレクトリ
  - ./src:/app/src
  - ./public:/app/public
  - ./templates:/app/templates
```

コンテナ環境変数に `TMUX_SOCKET=/tmp/tmux-1000/default` を設定してください。

---

## 環境変数

| 変数 | デフォルト | 説明 |
|---|---|---|
| `PORT` | `4000` | HTTP ポート |
| `TMUX_SOCKET` | （自動検出） | 明示的な tmux ソケットパス |
| `WORK_OS_HOSTS` | （ローカルのみ） | ホスト設定の JSON 配列 |
| `NODE_ENV` | `development` | ビルド済みサーバーでは `production` に設定 |

---

## マルチホスト設定

work-os は複数マシンのセッションを集約できます。`WORK_OS_HOSTS`（JSON 配列）で設定します。

### サポートするプロバイダーの種類

| 種別 | トランスポート | 用途 |
|---|---|---|
| `local` | 直接 tmux ソケット | 同一マシンまたは Docker bind-mount |
| `ssh` | SSH + tmux | リモート Linux / WSL ホスト |
| `http` | HTTP REST → work-os エージェント | SSH が利用できないホスト |

### ローカル単一ホスト（デフォルト）

設定不要。work-os がローカルソケットを自動解決します。

### ローカル + SSH リモート

```yaml
# docker-compose.yml
environment:
  WORK_OS_HOSTS: |
    [
      {
        "hostId": "local",
        "displayName": "Local",
        "type": "local"
      },
      {
        "hostId": "wsl",
        "displayName": "WSL",
        "type": "ssh",
        "sshTarget": "opa@172.29.214.157",
        "socketPath": "/tmp/tmux-1000/default"
      }
    ]
```

#### SSH の前提条件

work-os コンテナ（またはプロセス）がパスワードプロンプトなしにリモートホストへ SSH できる必要があります。

```bash
# コンテナ内でキーを生成
ssh-keygen -t ed25519 -f /root/.ssh/id_ed25519 -N ""
cat /root/.ssh/id_ed25519.pub
# 出力をリモートホストの ~/.ssh/authorized_keys に追加
```

`SshTmuxProvider` はデフォルトで ControlMaster 多重化を使用:

```
BatchMode=yes
ConnectTimeout=5
ControlMaster=auto
ControlPath=/tmp/ssh-wos-%r@%h:%p
ControlPersist=60
StrictHostKeyChecking=accept-new
```

### ローカル + HTTP エージェント

SSH で直接到達できないホスト（例: NAT 背後の WSL に到達しようとする Docker コンテナ）の場合:

1. **リモートマシンで work-os HTTP エージェントを起動**:

   ```bash
   # リモートホスト / WSL で実行
   cd /home/opa/work/work-os
   PORT=3001 npm run dev:agent
   ```

   エージェントは `GET /api/sessions`、`GET /api/sessions/:id`、`POST /api/sessions/:id/send-literal` などを公開します。

2. **HTTP プロバイダーを設定**:

   ```yaml
   WORK_OS_HOSTS: |
     [
       { "hostId": "local", "displayName": "Local", "type": "local" },
       { "hostId": "wsl",   "displayName": "WSL",   "type": "http",
         "agentUrl": "http://172.29.214.157:3001" }
     ]
   ```

> **セキュリティ注意**: HTTP エージェントには認証がありません。プライベート / 信頼済みネットワーク内でのみアクセス可能にしてください。

### 代替: 個別環境変数

JSON 配列の代わりに個別変数も使用できます:

```bash
WORK_OS_HOSTS_HVU='{"hostId":"hvu","displayName":"HVU","type":"local"}'
WORK_OS_HOSTS_WSL='{"hostId":"wsl","displayName":"WSL","type":"ssh","sshTarget":"opa@172.x.x.x","socketPath":"/tmp/tmux-1000/default"}'
```

---

## セットアップの確認

```bash
# ヘルスエンドポイントを確認
curl http://localhost:4311/healthz
# { "ok": true, "sessions": 2, "pty": 1, "mirror": 1, "remote-websocket": 0 }

# tmux セッションが見えることを確認
curl http://localhost:4311/api/sessions | jq '.sessions[].id'
```

---

## 最初のセッションを作成する

ダッシュボードから:

1. **起動** フォームに名前、コマンド（例: `claude`）、作業ディレクトリを入力。
2. **起動** をクリック。
3. 新しいセッションがリストに表示されます。ターミナルカードをクリックして接続。

API 経由:

```bash
curl -X POST http://localhost:4311/api/sessions \
  -H 'Content-Type: application/json' \
  -d '{"name":"claude-work","command":"claude","cwd":"/home/opa/work"}'
```

---

## 次のステップ

- [アーキテクチャ](architecture-ja.md) — ブリッジとプロバイダーシステムの仕組みを理解する
- [セキュリティ](security-ja.md) — **ネットワークに公開する前に必読**
