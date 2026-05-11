# DGE Session: Work-OS セキュリティレビュー
- **Date**: 2026-03-30
- **Template**: security-review
- **Preset**: pre-release
- **Status**: Pending (プロダクト自体が pending)

## Round 1: 千石 + Red Team + ハウス

| # | Gap | Category | Severity |
|---|-----|----------|----------|
| 1 | 全 API エンドポイントに認証が存在しない | Missing logic | Critical |
| 2 | WebSocket 接続に認証なし。任意の sessionId を指定可能 | Missing logic | Critical |
| 3 | CORS が `origin: true` で CSRF/クロスオリジン攻撃が成立 | Security gap | Critical |
| 4 | `process.kill()` に任意の PID を渡せる | Missing logic | Critical |
| 5 | PID=1 攻撃でコンテナ停止が可能 | Security gap | Critical |
| 6 | WebSocket に rate limiting / payload size 制限がない | Missing logic | High |
| 7 | SSH ControlPath が `/tmp` にある（ソケットハイジャック） | Security gap | High |
| 8 | コンテナ再ビルドで known_hosts リセット → 毎回 MITM 可能 | Security gap | High |
| 9 | ホスト tmux ソケットマウントでコンテナ侵害 = ホスト侵害 | Integration gap | Critical |
| 10 | 破壊的操作の確認プロンプトに自動で `y` を返す | Safety gap | High |
| 11 | 悪意あるプロセスが偽プロンプトで Commander を騙せる | Security gap | High |
| 12 | シェルプロンプト誤検出で `y` を繰り返し送信 | Safety gap | Medium |

## Round 2: 今泉 + ソウル + リヴァイ

| # | Gap | Category | Severity |
|---|-----|----------|----------|
| 13 | PTY 同時書き込みで入力がインターリーブ | Integration gap | Medium |
| 14 | `setMetadata` の read-modify-write が非アトミック | Missing logic | High |
| 15 | レース条件で auto-accept が誤セッションをターゲット | Safety gap | Critical |
| 16 | キー入力が平文で Docker ログに記録される | Security gap | Critical |
| 17 | キーストロークログが法的に「キーロガー」相当 | Legal gap | High |
| 18 | Docker ログにローテーション・保持期限がない | Ops gap | Medium |
| 19 | セッション数に上限がなく DoS が可能 | Missing logic | High |
| 20 | WebSocket 接続 fan-out によるブロードキャスト爆発 | Missing logic | High |
| 21 | Cloudflare Tunnel が DDoS 中継点になるリスク | Legal gap | Medium |
| 22 | サーバー再起動で全メタデータ消失 | Ops gap | High |
| 23 | SIGTERM ハンドラ未実装。ゾンビプロセス蓄積 | Ops gap | High |
| 24 | `/mnt/c/var` RW マウント + auto-accept で Windows ファイル削除 | Safety gap | Critical |
| 25 | テンプレート複製 API にパストラバーサル | Security gap | Critical |
| 26 | パストラバーサルで SSH 秘密鍵等の任意ファイル読み取り | Security gap | Critical |
| 27 | OWASP A01 該当の脆弱性が Tunnel 経由で公開状態 | Legal gap | Critical |

## 統計

| Severity | 件数 |
|----------|------|
| Critical | 10 |
| High | 10 |
| Medium | 7 |

## 最も非自明な発見 (Top 3)

1. **Gap-25/26**: テンプレート複製 API のパストラバーサルで SSH 秘密鍵が読み取り可能
2. **Gap-24**: `/mnt/c/var` RW マウント + auto-accept の組み合わせで Windows データ破壊
3. **Gap-15**: メタデータ競合で auto-accept が別セッションをターゲットにする

## Gap 詳細 (Observe / Suggest / Act)

### Gap-1: 認証の完全な欠如
- **Observe**: 12 の REST エンドポイントと WebSocket に認証/認可が一切ない
- **Suggest**: JWT または API key ベースの認証ミドルウェアを全ルートに適用すべき
- **Act**: Cloudflare Access (Zero Trust) を Tunnel 前段に設置するのが最速

### Gap-2: WebSocket セッションハイジャック
- **Observe**: WebSocket の `start` イベントで任意の `sessionId` を指定でき、認証チェックがない
- **Suggest**: WebSocket 接続時にトークン検証を行い、セッション所有権を確認すべき
- **Act**: Socket.IO の `connection` ハンドラで `auth` パラメータを検証

### Gap-3: CORS の設定ミス
- **Observe**: `origin: true, credentials: true` で全オリジンから認証付きリクエストが可能
- **Suggest**: 許可するオリジンをホワイトリストで明示指定すべき
- **Act**: `cors: { origin: ['https://your-domain.com'], credentials: true }`

### Gap-4 & 5: 任意プロセス Kill
- **Observe**: `/api/sessions/[id]/clients` の `kill` アクションで PID の所有権を検証していない
- **Suggest**: 対象セッションの tmux クライアント PID リストと照合すべき
- **Act**: `allowedPids` チェックを追加

### Gap-6: WebSocket DoS
- **Observe**: `command` イベントに頻度制限もペイロードサイズ制限もない
- **Suggest**: 1 接続あたりのイベント頻度制限と payload 上限を設けるべき
- **Act**: Socket.IO middleware で rate limiting + `maxHttpBufferSize` 設定

### Gap-7: SSH ControlSocket の配置
- **Observe**: `/tmp/ssh-wos-%r@%h:%p` は他プロセスからアクセス可能
- **Suggest**: `/root/.ssh/sockets/` (700) に移動すべき
- **Act**: `ControlPath=/root/.ssh/sockets/%C`

### Gap-8: SSH MITM
- **Observe**: コンテナ再ビルドで `known_hosts` がリセットされ毎回初回接続扱い
- **Suggest**: 既知ホスト鍵をイメージにベイクまたはボリュームで永続化
- **Act**: `COPY known_hosts /root/.ssh/known_hosts` or Docker volume

### Gap-9: コンテナ → ホスト侵害パス
- **Observe**: ホスト tmux ソケットを RW マウントしておりコンテナ侵害 = ホスト侵害
- **Suggest**: read-only マウントまたは SSH 経由に統一
- **Act**: `volumes: - /tmp/tmux-1000:/tmp/tmux-1000:ro`

### Gap-10: Auto-Accept の破壊的操作
- **Observe**: `rm -rf` や `git push --force` の確認にも `y` を自動返答
- **Suggest**: 危険コマンドのブラックリストでマッチ時は自動応答をスキップ
- **Act**: `isDangerousContext()` チェック追加

### Gap-11: Commander への Prompt Injection
- **Observe**: ターゲットセッション内プロセスが偽プロンプトを出力すれば Commander が自動応答
- **Suggest**: 直前の実行コマンドのコンテキストを考慮し既知ツールのみに応答
- **Act**: プロンプト検出にコマンドコンテキストを追加

### Gap-12: アイドルセッションへの誤送信
- **Observe**: `/?$/` でログの `?` に反応、シェルプロンプトにも反応し `y` を送り続ける
- **Suggest**: 前回と同じ出力なら応答スキップ
- **Act**: `lastRespondedContent` で重複排除

### Gap-13: PTY Write Interleaving
- **Observe**: 複数クライアントの同時 PTY 書き込みでキー入力が混在
- **Suggest**: 書き込みキューまたはセッションあたり 1 writer 制限
- **Act**: write queue or single-writer lock

### Gap-14: Metadata Race Condition
- **Observe**: `setMetadata` が get→spread→set で非アトミック
- **Suggest**: フィールド単位の更新関数に変更
- **Act**: `updateMetadataField(id, key, value)` 形式に

### Gap-15: Cross-Session Auto-Accept Mislinking
- **Observe**: メタデータ競合で auto-accept が誤セッションをターゲットにする
- **Suggest**: Commander 開始時に target ID をイミュータブルに保持
- **Act**: `readonly targetSessionId` パターン + ポーリング時に再検証

### Gap-16: Credential Logging
- **Observe**: `server.ts:591` で全キー入力を `console.log` で記録
- **Suggest**: production ではコマンドログを無効化、または redaction フィルタ
- **Act**: `if (process.env.NODE_ENV !== 'production') console.log(...)` or redact

### Gap-17: Legal Keystroke Logging
- **Observe**: キーストロークの記録がキーロガーと同等の法的分類になりうる
- **Suggest**: 利用規約・プライバシーポリシーに明記、またはログ自体を削除
- **Act**: ToS 策定 + ログ redaction

### Gap-18: Log Retention
- **Observe**: Docker ログにローテーション・保持期限・アクセス制御なし
- **Suggest**: Docker の `--log-opt max-size` でローテーション設定
- **Act**: `docker-compose.yml` に `logging: { options: { max-size: "10m", max-file: "3" } }`

### Gap-19: Unbounded Session Creation
- **Observe**: セッション数上限なし
- **Suggest**: 最大セッション数を設定可能に（例: MAX_SESSIONS=50）
- **Act**: `POST /api/sessions` で上限チェック

### Gap-20: WebSocket Fan-out Amplification
- **Observe**: 1 セッションへの接続数無制限、全員にブロードキャスト
- **Suggest**: セッションあたりの最大接続数を制限（例: 10）
- **Act**: `bridge.sockets.size >= MAX_CLIENTS_PER_SESSION` チェック

### Gap-21: Tunnel Abuse Risk
- **Observe**: リソース枯渇で Tunnel が DDoS 中継点になりうる
- **Suggest**: Cloudflare Access で認証ゲートを前段に設置
- **Act**: Cloudflare Zero Trust の設定

### Gap-22: No State Persistence
- **Observe**: サーバー再起動で Commander/target リンク・ロール・auto-accept 状態が全消失
- **Suggest**: メタデータを JSON ファイルまたは SQLite に永続化
- **Act**: `sessionStore.persist()` + 起動時 `sessionStore.restore()`

### Gap-23: No Graceful Shutdown
- **Observe**: SIGTERM ハンドラ未実装。PTY がゾンビ化
- **Suggest**: SIGTERM で全 PTY を kill し、ソケットを切断してから終了
- **Act**: `process.on('SIGTERM', () => { bridges.forEach(b => b.ptyProcess.kill()); ... })`

### Gap-24: Windows FS Destruction via Auto-Accept
- **Observe**: `/mnt/c/var` が RW マウント + auto-accept で破壊的確認に `y` 返答
- **Suggest**: `:ro` マウントに変更、または auto-accept にファイル操作ブラックリスト
- **Act**: `docker-compose.yml` で `/mnt/c/var:/mnt/c/var:ro`

### Gap-25: Path Traversal in Template Duplicate
- **Observe**: `POST /api/templates` の `sourceName` にパストラバーサルが可能
- **Suggest**: テンプレート名に `sanitizeSessionName` と同等のバリデーション適用
- **Act**: `sourceName.replace(/[^a-zA-Z0-9._-]/g, '-')`

### Gap-26: Arbitrary File Read via Template API
- **Observe**: パストラバーサル + テンプレート一覧で SSH 秘密鍵等を外部に漏洩可能
- **Suggest**: `realpath` で解決後のパスが templates ディレクトリ内か検証
- **Act**: `if (!resolvedPath.startsWith(USER_TEMPLATES_DIR)) return 403`

### Gap-27: Public Exposure of Critical Vuln
- **Observe**: OWASP A01 該当の脆弱性が Cloudflare Tunnel 経由で公開状態
- **Suggest**: Tunnel を一時停止するか、Cloudflare Access で認証ゲートを即座に設置
- **Act**: `cloudflared tunnel cleanup` or Cloudflare Access policy
