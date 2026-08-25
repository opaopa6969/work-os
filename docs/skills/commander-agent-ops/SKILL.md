---
name: commander-agent-ops
description: work-os の Commander Agent（auto-accept）を安全に運用する手順
volta:
  version: 1
  namespace: workos
  locality: service
  applies_when: workos__set_auto_accept または workos__get_auto_accept を使うとき
  requires:
    - workos__list_sessions
    - workos__capture_session
    - workos__send_key
    - workos__set_auto_accept
    - workos__get_auto_accept
  min_role: MEMBER
  export: true
---

# Commander Agent 運用手順

## 目的

work-os の Commander Agent は、指定した対象セッション（target）の画面を監視し、入力待ちプロンプト（y/n 確認や番号選択）を検出すると自動で応答キーを送信する機能。無人運用（CI での AI エージェント実行など）に有用だが、誤操作のリスクがあるため安全に運用する。

## 前提

- Commander セッションと Target セッションが両方存在すること（`workos__list_sessions` で確認）。
- Commander は auto-accept を管理するセッション。Target は監視対象。
- auto-accept は 5 秒間隔で Target の画面をキャプチャし、プロンプトパターンにマッチすると応答する。

## 手順

1. **セッション一覧を取得**:
   `workos__list_sessions` → `{ sessions: [...] }` から `id`（compositeId 形式 `hostId:sessionName`）を特定。

2. **Commander と Target を起動**（未起動の場合）:
   `workos__create_session({ name: "commander-1", command: "claude", cwd: "/path/to/project", templateName: "commander", sessionRole: "commander", linkedSessionId: "<target-id>" })`
   Target が未起動なら先に `create_session` で Target を起動し、その `compositeId` を `linkedSessionId` に渡す。

3. **auto-accept を有効化**:
   `workos__set_auto_accept({ commanderSessionId: "<commander-id>", enabled: true, targetSessionId: "<target-id>" })`
   両セッションが存在しないとエラーになる（サーバ側で `pool.resolve` で検証）。

4. **状態確認**:
   `workos__get_auto_accept({ commanderSessionId: "<commander-id>" })` → `{ enabled, targetSessionId, role }`。

5. **停止**:
   `workos__set_auto_accept({ commanderSessionId: "<commander-id>", enabled: false })` で停止・リンク解除。

## 安全上の注意

- **プロンプト検出パターンが緩い**: `y/n`、`?`、`proceed?`、`continue?`、番号選択等のパターンにマッチする。意図しないプロンプトに自動応答する可能性がある。重要な作業では Target の画面を `workos__capture_session` で定期的に確認すること。
- **ホワイトリストなし**: 任意のプロンプトに応答する。破壊的操作を含むコマンドの確認プロンプトにも応答する可能性がある。Target で実行するコマンドは信頼できるものに限定すること。
- **停止し忘れ**: auto-accept は明示的に停止するまで動き続ける。作業終了後は必ず `set_auto_accept(enabled: false)` を呼ぶこと。
- **複数 Commander の衝突**: 同一 Target に複数の Commander を link しないこと（`sessionStore` は上書きされる）。

## 組み合わせ例

```
workos__list_sessions
  → commander-id と target-id を特定
  → workos__set_auto_accept({ commanderSessionId, enabled: true, targetSessionId })
  → （作業中）workos__capture_session({ id: target-id }) で定期確認
  → workos__set_auto_accept({ commanderSessionId, enabled: false }) で停止
```
