# work-os MCP 化調査（Phase 1）

## 概要

**work-os** はブラウザベースの tmux 操作ダッシュボードである。Next.js 16 + Express 5 + Socket.IO で構成され、複数ホスト（local / SSH / HTTP agent）の tmux セッションを 1 画面に集約し、ライブストリーミング・コマンド送信・Commander Agent による自動応答を行う。

既に volta にホスト済み（`https://work.unlaxer.org`）、`/healthz` エンドポイントあり、REST API が稼働中。MCP サーバは未実装。

- **リポジトリ種類**: `service`（常駐サーバあり）
- **技術スタック**: Node.js 20 / Next.js 16 / Express 5 / Socket.IO 4 / node-pty / xterm.js 5
- **公開 URL**: `https://work.unlaxer.org`（Cloudflare Tunnel 経由）

## 判定と理由

**判定: `wrap`** — 既存 REST API を薄く包む

### 採用の根拠

1. **REST API + healthz が既に稼働中**: `/api/sessions`（GET/POST）、`/api/sessions/:id`（GET/DELETE）、`/api/sessions/:id/send-key`、`/api/sessions/:id/auto-accept`（GET/POST）、`/api/sessions/:id/clients`（GET/POST）、`/api/sessions/:id/shell`、`/api/templates`（GET/POST）、`/healthz` が全て実装済み。MCP 化はこれらの HTTP エンドポイントを tool として薄くラップするだけで完結する。新規実装は最小限。

2. **エージェントから呼ぶ価値が高い**: 「tmux セッション一覧取得 → 画面キャプチャ → 入力待ち判定 → キー送信 → auto-accept 制御」というフローは、エージェントが自律的に tmux 上の AI エージェントを監視・操作する上で中心的な能力である。

3. **volta-index と補完関係**: `index__agent_*`（fork/send/fanout/stop）が tmux の外側のエージェントプロセス管理を担当するのに対し、work-os MCP は **tmux セッション内部**の観察・操作に特化する。重複しない。

4. **常駐の価値あり**: Next.js + Express の常駐プロセスが Socket.IO でブリッジを管理しており、起動コストが低くない。既に volta 上で稼働中のため、MCP エンドポイントを追加するだけでよい。

## 公開候補

| kind | name | io | 副作用 | 長時間 | 対応する既存 API |
|------|------|----|--------|--------|----------------|
| tool | `list_sessions` | `{}` → `{ sessions: [...] }` | read | No | `GET /api/sessions` |
| tool | `create_session` | `{ name, command, cwd, ... }` → `{ compositeId }` | write | No | `POST /api/sessions` |
| tool | `capture_session` | `{ id }` → `{ content, isWaitingForInput, lastLine }` | read | No | `GET /api/sessions/:id` |
| tool | `send_key` | `{ id, key }` → `{ message }` | write | No | `POST /api/sessions/:id/send-key` |
| tool | `kill_session` | `{ id }` → `{ message }` | destructive | No | `DELETE /api/sessions/:id` |
| tool | `open_shell` | `{ id }` → `{ newSession, compositeId, cwd }` | write | No | `POST /api/sessions/:id/shell` |
| tool | `list_clients` | `{ id }` → `{ clients: [...] }` | read | No | `GET /api/sessions/:id/clients` |
| tool | `control_clients` | `{ id, action, tty?, pid? }` → `{ ok }` | destructive | No | `POST /api/sessions/:id/clients` |
| tool | `set_auto_accept` | `{ commanderSessionId, enabled, targetSessionId? }` → `{ message }` | write | No | `POST /api/sessions/:id/auto-accept` |
| tool | `get_auto_accept` | `{ commanderSessionId }` → `{ enabled, targetSessionId }` | read | No | `GET /api/sessions/:id/auto-accept` |
| tool | `list_templates` | `{}` → `{ templates: [...] }` | read | No | `GET /api/templates` |
| resource | `spec` | `workos://spec` — 能力の機械可読仕様 | read | — | — |
| resource | `guide` | `workos://guide` — 使い方 | read | — | — |
| skill | `commander-agent-ops` | Commander Agent 運用手順（locality: service） | — | — | — |

### 破壊系 tool の confirm 対応

- `kill_session`, `control_clients`（action=kill）: `confirm: bool=false`（デフォルト dry-run）を必須とする。
- `send_key`: 破壊的だが高頻度で使われるため、確認は呼び出し側に委ねる（description で危険度を明記）。

## 組み合わせ例

1. **自動応答パイプライン**: `workos__capture_session(id)` → `isWaitingForInput=true` を検知 → `workos__send_key(id, 'y')` で自動応答 → `index__agent_send` で別エージェントに結果を中継
2. **無人エージェント運用**: `workos__list_sessions` → `workos__create_session(command='claude', templateName='commander')` → `workos__set_auto_accept(commanderId, targetId)` で auto-accept 開始 → `volta__svc_health` で全体健全性確認
3. **マルチエージェント連携**: `workos__capture_session` → 内容解析 → `index__agent_fork` で作業エージェント起動 → `workos__send_key` で結果を投入

## 依存と協調

| 相手 repo | 向き | 能力 | 現存 | 備考 |
|-----------|------|------|------|------|
| volta-index | provides_to | work-os のセッション操作を他サービスのエージェントが利用可能になる。index が tmux 外のエージェント管理、workos が tmux 内の操作を担当し補完関係。 | Yes | index MCP namespace=`index` は fork/send/fanout を提供 |
| volta-platform | depends_on | `volta__svc_deploy` / `volta__svc_health` / `volta__svc_status` で work-os サービス自身の管理 | Yes | work-os は既に volta にホスト済み。MCP 追加時は `volta__svc_add` で services.json 編集が必要だが Phase 1 では実施しない |

## ライブラリのサーバ化

該当しない。work-os は既に常駐サーバとして稼働中であり、MCP 化は既存 API のラッパー追加のみ。

## リスク

1. **認証なし**: REST API・Socket.IO ともに認証が一切ない。MCP 経由でキー送信・セッション kill・クライアント kill が可能。破壊系 tool に `confirm` / dry-run を必須とする。
2. **Commander auto-accept にホワイトリストなし**: 任意のプロンプトパターンに自動応答する。正規表現が緩く、意図しない操作を引き起こす可能性がある。
3. **Socket.IO は stateful**: WebSocket ベースのライブストリーミングは MCP tool の同期的モデルに適さない。`capture_session`（polling）と `send_key` の組み合わせで代替する。
4. **SSH 認証情報の露出**: マルチホスト構成では `sshTarget` が環境変数に含まれる。MCP 経由でこれらを露出させない。

## 持ち主への質問

1. Socket.IO ベースのライブストリーミングを MCP でどう扱うか（polling で十分か、MCP resource subscription で対応するか）
2. namespace `workos` が予約語（`catalog` / `probe` / `skill`）と衝突しないか確認が必要
3. `confirm` / dry-run の粒度: `kill_session` と `control_clients(action=kill)` は confirm 必須とするが、`send_key` はどうするか（破壊的だが頻度が高い）
