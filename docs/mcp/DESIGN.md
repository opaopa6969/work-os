# work-os MCP 化設計（Phase 2）

> Phase 1 調査: `docs/mcp/survey.json` / `docs/mcp/SURVEY.md`（2026-08-21）。判定 `wrap`。

## 1. namespace と種別

- **namespace**: `workos`
- **種別**: `wrap` — 既存 Next.js + Express サーバ（port 5043）の Express プロセスに `/mcp` エンドポイントを追加し、既存 REST API を MCP tool として薄く包む。新規プロセス・新規ポートなし。

## 2. tools 表

namespace `workos` をファサードが前置する（呼び出し側は `workos__list_sessions` 等）。

| name | 目的 | 入力 schema（要点） | 出力の形 | 副作用 | dry-run | job型 | 所要 | min_role |
|------|------|---------------------|----------|--------|---------|-------|------|----------|
| `list_sessions` | 全ホストの tmux セッション一覧 | `{}` | `{ sessions: [{ id, name, hostId, hostName, command, directory, isAttached, currentCommand, currentPath, suggestedMode, sessionRole, linkedSessionId }] }` | read | — | No | <1s | VIEWER |
| `create_session` | 新規 tmux セッション起動 | `{ name: str, command: str, cwd: str, templateName?: str, hostId?: str, sessionRole?: str, linkedSessionId?: str }` | `{ compositeId, sessionName, hostId, cwd, command, instructionPath? }` | write | — | No | <1s | MEMBER |
| `capture_session` | 画面キャプチャ + 入力待ち判定 | `{ id: str }` | `{ id, content, isWaitingForInput, lastLine, updatedAt }` | read | — | No | <1s | VIEWER |
| `send_key` | tmux セッションにキー送信 | `{ id: str, key: str, confirm?: bool }` | `{ message }` | write | confirm=false で内容プレビューのみ返す | No | <1s | MEMBER |
| `kill_session` | tmux セッション終了 | `{ id: str, confirm?: bool }` | `{ message }` | destructive | confirm=false で対象確認のみ | No | <1s | MEMBER |
| `open_shell` | 同 CWD で子 bash セッション派生 | `{ id: str }` | `{ newSession, compositeId, cwd }` | write | — | No | <1s | MEMBER |
| `list_clients` | セッションの tmux クライアント一覧 | `{ id: str }` | `{ sessionId, clients: [{ name, pid, tty, size, created, activity }] }` | read | — | No | <1s | VIEWER |
| `control_clients` | クライアント detach / kill | `{ id: str, action: "detach"|"detach-all"|"kill", tty?: str, pid?: int, confirm?: bool }` | `{ ok, action, ... }` | destructive | confirm=false で対象一覧のみ | No | <1s | MEMBER |
| `set_auto_accept` | Commander auto-accept 有効/無効 | `{ commanderSessionId: str, enabled: bool, targetSessionId?: str }` | `{ message, commanderSessionId, targetSessionId? }` | write | — | No | <1s | MEMBER |
| `get_auto_accept` | auto-accept 状態取得 | `{ commanderSessionId: str }` | `{ commanderSessionId, enabled, targetSessionId, role }` | read | — | No | <1s | VIEWER |
| `list_templates` | エージェントテンプレート一覧 | `{}` | `{ templates: [{ name, description }] }` | read | — | No | <1s | VIEWER |

### confirm / dry-run の粒度（Phase 1 open_question #3 の回答）

- `kill_session`: **confirm 必須**（destructive）。`confirm=false` で対象セッションの情報を返す。
- `control_clients(action=kill)`: **confirm 必須**（プロセス SIGTERM）。`confirm=false` で対象クライアント一覧を返す。
- `control_clients(action=detach|detach-all)`: **confirm 不要**（detach はセッションを止めない。ユーザーを外すだけ）。
- `send_key`: **confirm オプション**（破壊的だが高頻度。呼び出し側が判断）。`confirm=false` ならキー内容をプレビューして送信しない。

## 3. resources 表

| uri | 内容 | mime |
|-----|------|------|
| `workos://spec` | 能力の機械可読仕様（§2.2 形式）。サーバ起動時に登録済み tool から自動生成 | `application/json` |
| `workos://guide` | 使い方ガイド（tool の呼び方、組み合わせ例、安全上の注意） | `text/markdown` |

## 4. prompts / skills

| 名前 | 種別 | 用途 | locality |
|------|------|------|----------|
| `commander-agent-ops` | skill | Commander Agent 運用手順（auto-accept の使い方、プロンプト検出パターン、安全上の注意） | service |

skill は `docs/skills/commander-agent-ops/SKILL.md` に置き、resource `skill://commander-agent-ops` でも返す。

### commander-agent-ops の frontmatter

```yaml
name: commander-agent-ops
description: work-os の Commander Agent（auto-accept）を安全に運用する手順
volta:
  version: 1
  namespace: workos
  locality: service
  applies_when: workos__set_auto_accept または workos__get_auto_accept を使うとき
  requires: [workos__list_sessions, workos__capture_session, workos__send_key, workos__set_auto_accept, workos__get_auto_accept]
  min_role: MEMBER
  export: true
```

## 5. 組み合わせ例

1. **自動応答パイプライン**:
   `workos__capture_session(id)` → `isWaitingForInput=true` を検知 → `workos__send_key(id, "y")` で自動応答 → `index__agent_send` で別エージェントに結果を中継。
   データ: `capture_session.content`（画面テキスト）→ `send_key.key`（応答）→ index のメッセージ。

2. **無人エージェント運用**:
   `workos__list_sessions` → `workos__create_session({name, command:"claude", cwd, templateName:"commander"})` → `workos__set_auto_accept({commanderSessionId, enabled:true, targetSessionId})` で auto-accept 開始 → `volta__svc_health` で全体健全性確認。
   データ: `list_sessions.sessions[].id` → `create_session.compositeId` → `set_auto_accept.commanderSessionId/targetSessionId`。

3. **マルチエージェント連携**:
   `workos__capture_session` → 内容解析 → `index__agent_fork` で作業エージェント起動 → `workos__send_key` で結果を投入。
   データ: `capture_session.content` → index の fork 指示 → `send_key.key`（投入内容）。

## 6. 依存と協調

| 相手 repo | 向き | 能力 | 現存 | issue-hub |
|-----------|------|------|------|-----------|
| volta-index | provides_to | work-os のセッション操作を index のエージェント管理（`index__agent_*`）と組み合わせて使えるようにする。index が tmux 外のエージェント fork/send/stop、workos が tmux 内の観察・操作。 | Yes | 投稿済み（暫定仕様で実装進行） |
| volta-platform | depends_on | `volta__svc_add` / `volta__svc_health` / `volta__svc_status` で work-os サービス自身の管理 | Yes | 既存依存、新規協調不要 |

### volta-index への協調内容（暫定仕様）

work-os MCP は tmux セッション内部の観察・操作に特化し、volta-index の `index__agent_*`（fork/send/fanout/stop）が tmux 外のエージェントプロセス管理を担当する。両者は補完関係にあり、データの受け渡しは composite ID（`hostId:sessionName` 形式）とキャプチャテキストで行う。index 側の入出力形式に合わせるため、work-os 側は `capture_session` で得た `content`（プレーンテキスト）と `isWaitingForInput`（bool）を提供する。

## 7. 非対応にした候補

Phase 1 から差分なし。Socket.IO ライブストリーミング（Phase 1 open_question #1）は **polling（`capture_session`）で対応** と決定。MCP resource subscription は使わない（MCP クライアントの対応が不安定で、polling で十分な価値があるため）。

## 8. 参加方法

- **manifest**: `volta.service.json`（root）。既存 manifest に `mcp` 項を追加。
- **ポート**: 5043（既存。割当表の 9278 は使わず、既存サービスの port を優先）。
- **ホスト**: 192.168.1.50（prod）。
- **hostname**: `work.unlaxer.org`（既存 Cloudflare tunnel）。
- **runtime**: source（既存 systemd user unit / nohup 起動）。
- **MCP path**: `/mcp`（既存 Express プロセスに追加）。
- **auth**: `minRole: MEMBER`（破壊系 tool が含まれるため VIEWER には見せない）。送信元 IP 制限は gateway が担う。
- **timeoutMs**: 110000（規定値）。

### mcp 項の内容

```json
{
  "mcp": {
    "enabled": true,
    "port": 5043,
    "path": "/mcp",
    "namespace": "workos",
    "min_role": "MEMBER",
    "timeoutMs": 110000,
    "description": "ブラウザベースの tmux 操作ダッシュボード。セッション一覧・キャプチャ・キー送信・auto-accept 制御を MCP tool として提供。"
  }
}
```

## 9. テスト方針

- **e2e**: MCP クライアント（`@modelcontextprotocol/sdk` の `Client` + `StreamableHTTPClientTransport`）で以下を検証:
  1. サーバ起動 → `/healthz` が 200。
  2. `tools/list` → 11 tool が `workos__*` prefix なし（ファサードが前置）で登録されている。全 tool に `annotations` がある。
  3. `resources/list` → `workos://spec` と `workos://guide` が存在。
  4. `list_sessions`（read-only）→ `{ sessions: [...] }` が返る。
  5. `list_templates`（read-only）→ `{ templates: [...] }` が返る。
  6. `kill_session({ id: "nonexistent", confirm: false })` → dry-run で対象確認。
  7. `kill_session({ id: "nonexistent", confirm: true })` → エラーだが confirm フロー確認。
- **CI**: vitest に `mcp/` テストを追加（サーバをバックグラウンド起動してクライアントで叩く）。
