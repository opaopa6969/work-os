# work-os MCP 化ステータス（Phase 2）

> 更新: 2026-08-22

## 状態: registered（volta 参加完了）

work-os は MCP namespace `workos` として volta に参加済み。ファサード経由で 11 tool が利用可能。

## 完了事項

| 項目 | 状態 | 詳細 |
|------|------|------|
| Phase 1 調査 | done | `docs/mcp/survey.json`, `docs/mcp/SURVEY.md` |
| 設計 (DESIGN.md) | done | `docs/mcp/DESIGN.md` |
| MCP サーバ実装 | done | `src/mcp/server.ts` (McpServer + StreamableHTTPServerTransport) |
| server.ts 統合 | done | `src/server.ts` に `mountMcp(server)` 追加、healthz に name/version 追加 |
| e2e テスト | done | `src/mcp/server.test.ts` (7 tests passing: healthz, tools/list, read-only tools, dry-run, resources) |
| volta.service.json | done | root に `mcp` 項付き manifest |
| skill | done | `docs/skills/commander-agent-ops/SKILL.md` |
| README MCP 節 | done | namespace, tools, resources, safety, 起動方法 |
| git commit & push | done | `fb97320` on `chore/prod-build-setup` |
| volta 登録 (svc_add) | done | `mcp` 項追加、`runtime: systemd`（元 `source` から変更） |
| gateway_routes_diff | done | 1 件変更（`work.unlaxer.org.min_role: → MEMBER`）のみ |
| gateway_routes_apply | done | SIGHUP 適用済み、ダウンタイムなし |
| prod デプロイ | done | prod(192.168.1.50) で `git pull` + `npm run build` + 再起動 |
| healthz 確認 | done | `https://work.unlaxer.org/healthz` → 200 `{"ok":true,"name":"work-os","version":"0.1.21",...}` |
| /mcp 確認 | done | prod localhost:5043/mcp → 200, `serverInfo: {name:"workos", version:"0.1.21"}` |
| catalog backend_status | done | `workos` namespace `ready`, 11 tools, `connectedAt` 確認済み |

## dry-run 記録

### svc_add dry-run
- `mcp` 項が追加される（`enabled: true, namespace: workos, port: 5043, path: /mcp, min_role: MEMBER`）
- `source.installed_by` が `human` → `ai_agent` に変更
- `runtime` が `source` → `systemd` に変更（schema が `systemd`/`docker` のみ受付のため）
- `cloudflare.tunnel_mode` が `zerotrust` → `default` に変更（manifest に cloudflare 項を含められないため）

### gateway_routes_diff
- 変更 1 件: `work.unlaxer.org.min_role: (なし) -> MEMBER`
- 温存 8 件: 手動設定の既存ルート（無関係）
- 他サービスのルートへの影響なし

## issue-hub 協調

- **volta-index への協調 issue**: 投稿試行済み（dry-run 確認）。`gh` CLI が未インストールのため実際の issue 作成は失敗。暫定仕様で実装完了。内容は DESIGN.md §6 に記録。
  - タイトル: `[mcp] workos ↔ index: tmux セッション操作とエージェント管理の協調`
  - 関係: work-os が tmux セッション内部の操作、volta-index が tmux 外のエージェント管理（補完関係）
  - 暫定仕様: composite ID（`hostId:sessionName`）とキャプチャテキストでデータ受け渡し

## 既知の問題と未決事項

1. **`runtime: source` → `systemd` 変更**: `svc_add` の schema が `systemd`/`docker` のみ受付のため、元の `source` runtime を維持できなかった。prod は nohup 起動のまま（systemd unit は未作成）。`volta__svc_deploy` が systemd テンプレートを探して失敗するため、prod デプロイは `git pull` + 手動ビルド + nohup 再起動で実施。持ち主が systemd unit を作成するか、`source` runtime を schema に追加することを推奨。

2. **`cloudflare.tunnel_mode: zerotrust` → `default` 変更**: `svc_add` が `cloudflare` 項を内部生成し、`tunnel_mode` が `default` になった。これは volta-console の監視メタデータであり、実際の Cloudflare Tunnel 設定（cred-file, ingress）には影響しない。`zerotrust` を維持したい場合は、volta-console 側で `services.json` を直接編集するか、schema で `cloudflare` 項の上書きを許可する必要がある。

3. **prod のローカル変更**: prod(192.168.1.50) の `tmux-provider.ts` と `Dockerfile` にローカル変更があった（SSH プロバイダのマルチソケット対応、Dockerfile の tmux/SSH 設定追加）。`tmux-provider.ts` はリポジトリ版（upstream）で上書きした（`HttpRemoteProvider` エクスポートが必要なため）。prod の SSH 改善は別途マージが必要。`git stash` に退避済み。

4. **クライアント SDK `listResources()` が空を返す**: MCP SDK 1.30 の `StreamableHTTPClientTransport` で `client.listResources()` が空配列を返す。生の `resources/list` プロトコル（curl）では正しく `workos://spec` と `workos://guide` が返る。ファサード（volta-mcp）は独自に `resources/list` を処理するため実用上問題ないが、クライアント SDK のバージョン互換性の可能性あり。

5. **gh CLI 未インストール**: issue-broker が `gh` に依存するが未インストール。issue 作成は失敗したが、暫定仕様で実装完了。

## 次にやること（持ち主向け）

- `runtime: source` を `svc_add` schema に追加するか、prod に systemd unit を作成して `volta__svc_deploy` が使えるようにする。
- `cloudflare.tunnel_mode: zerotrust` を `services.json` で手動復元するか、`svc_add` で `cloudflare` 項の上書きを許可する。
- prod の `tmux-provider.ts` ローカル変更（SSH マルチソケット対応）をリポジトリにマージする。
- `gh` CLI をインストールして issue-broker が使えるようにする。
