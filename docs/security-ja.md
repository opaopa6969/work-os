[English version](security.md)

# セキュリティ

> **work-os をローカルホスト以外のネットワークに公開する前に必読。**

---

## 現状: 認証なし

work-os は**認証機能を持ちません**。個人利用・ローカル利用のための意図的なトレードオフですが、信頼されていないネットワークからサービスに到達可能な場合には深刻な問題をはらんでいます。

### 認証なしに公開される内容

| 対象 | 公開内容 |
|---|---|
| `GET /api/sessions` | tmux セッション名・コマンド・作業ディレクトリの一覧 |
| `POST /api/sessions` | 任意コマンドで新しい tmux セッションを作成 |
| `DELETE /api/sessions/:id` | 名前で任意の tmux セッションを終了 |
| `POST /api/sessions/:id/send-key` | 任意のキーストロークを任意セッションに送信 |
| `POST /api/sessions/:id/shell` | 任意の作業ディレクトリでシェルを開く |
| Socket.IO `command` イベント | アタッチ済みターミナルへ任意の入力を送信 |
| Socket.IO `start` イベント | 複合 ID で任意の tmux セッションにアタッチ |

**work-os のポートに到達できるクライアントは、ホストマシン上で任意のコマンドを実行できます。**

### CORS: `origin: true`

Socket.IO は以下のように設定されています:

```typescript
cors: {
  origin: true,   // 任意のオリジンからの接続を受け入れ
  credentials: true,
}
```

これは、同じネットワーク上の誰かが訪問した悪意あるウェブページが work-os への WebSocket を開き、ターミナルコマンドを発行できることを意味します。共有ネットワークや公開ネットワークで work-os を実行しないでください。

---

## HTTP エージェント: こちらも認証なし

オプションの HTTP エージェント（`npm run dev:agent`）は、認証もレート制限もなく tmux セッション管理を REST で公開します。プライベートな信頼済みネットワークセグメントからのみアクセス可能にしてください。

---

## Commander Agent: 入力ホワイトリストなし

Commander Agent（`AutoAcceptManager`）は、プロンプト検出パターンに一致する**任意の**セッションに自動応答します:

- `y/n` パターン
- 番号付き選択メニュー（例: `1. Allow`、`2. Deny`）
- シェルプロンプト（`$`、`#`、`>`）

セッション単位のホワイトリスト、パターン拒否リスト、人間による確認ステップはありません。破壊的な操作を実行するセッションに commander をアタッチすると、commander はそれを承認します。

**推奨**: 確認済みで無人実行を信頼できるセッションにのみ commander をアタッチしてください。

---

## 安全なデプロイ方法

### オプション 1: Cloudflare Tunnel + Access（リモートアクセスに推奨）

Cloudflare Tunnel はファイアウォールルールを開かずにローカルポートを公開します。Cloudflare Access はその前面にアイデンティティベースの認証を追加します。

```bash
# cloudflared をインストール
# https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/

cloudflared tunnel --url http://localhost:3000
```

Cloudflare Access を設定すると、認証済みユーザー（Google / GitHub / メール OTP）のみが work-os にアクセスできます。サービス自体は認証されていませんが、すべてのトラフィックが Cloudflare の認証レイヤーを通過します。

> **注意**: Cloudflare Access は HTTP リクエストのみを保護します。WebSocket パスの Access ポリシーを明示的に設定しない限り、WebSocket アップグレードは保護されません。

### オプション 2: ローカルのみ（デフォルト、最も安全）

localhost にのみバインド:

```bash
PORT=4311 npm run dev
# サーバーはデフォルトで 0.0.0.0 をリッスン — ファイアウォールで外部アクセスをブロック
```

または `docker-compose.yml`:

```yaml
ports:
  - "127.0.0.1:3000:3000"   # localhost のみにバインド
```

### オプション 3: VPN / プライベートネットワーク

WireGuard や Tailscale など、全クライアントが信頼済みのネットワーク上でのみ work-os を実行する。

---

## 今後の認証追加計画

認証はまだ実装されていません。計画しているアプローチは以下の通りです:

1. **短期**: 共有シークレット（`WORK_OS_SECRET` 環境変数）を全 API リクエストの `Bearer` トークンおよび Socket.IO ハンドシェイクのクエリパラメーターとしてチェックする。
2. **中期**: シンプルなパスフレーズログインページ後に発行するセッションクッキー — 外部 ID プロバイダー不要。
3. **長期**: アプリケーション内で認証を実装するのではなく、上流プロキシ（Cloudflare Access、Authelia、Authentik など）と統合する。

これらのタイムラインはコミットされていません。

---

## まとめ

| リスク | 深刻度 | 現在の対策 |
|---|---|---|
| 認証なし REST API | 致命的 | ローカルのみ または Cloudflare Tunnel + Access |
| `cors: origin: true` | 高 | 共有 / 公開ネットワークで実行しない |
| Commander Agent にホワイトリストなし | 中 | 信頼済みセッションにのみ使用 |
| HTTP エージェントに認証なし | 高 | プライベートネットワークのみ |
| `next.config.ts` stub | 低 | 外見上の問題 — ファイルを削除 |
| `next.config.js` の `typescript.ignoreBuildErrors: true` | 中 | ビルド時に TypeScript エラーがサイレントに無視される |
