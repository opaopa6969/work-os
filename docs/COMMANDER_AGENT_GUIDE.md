# 司令官Agent ユーザーガイド

[English](#commander-agent-user-guide) | [日本語](#司令官agent-ユーザーガイド)

---

## Commander Agent User Guide

### What is Commander Agent?

The Commander Agent is a feature that allows you to attach an autonomous "commander" session to any target session. The commander automatically responds to prompts, eliminating the need for manual interaction during long-running operations.

**Perfect for:**
- Approving permission prompts in Claude Code file edits
- Handling yes/no confirmations in build processes
- Automating routine selections in CI/CD workflows
- Unattended operation of AI agent sessions

### How It Works

#### Step-by-Step Usage

1. **Open Work OS Dashboard**
   - Navigate to http://localhost:4311 (or your Work OS instance)
   - View your running tmux sessions

2. **Find Your Target Session**
   - Locate the session you want to attach a commander to
   - This could be any coding agent (`claude`, `codex`, `gemini`) or script

3. **Click "⚔️ Add Commander" Button**
   - Located in the session footer (bottom right of session card)
   - A modal dialog appears

4. **Configure the Commander**
   - **Commander Name**: Enter a unique name (e.g., `commander-claude`, `approve-bot`)
   - **Template**: Optionally select a commander template (filtered for 'commander' role)
   - Click **Launch**

5. **Monitor the Sessions**
   - New commander session appears in dashboard
   - Commander session shows badge: `⚔️ Commander`
   - Target session shows badge: `🎯 Watched by: {commander-name}`

6. **Auto-Response Happens Automatically**
   - When target session shows a prompt, commander responds in ~5 seconds
   - Check server logs for: `[auto-accept] Detected prompt, sending: y\n`

#### Auto-Response Patterns

The commander automatically detects and responds to:

| Pattern | Example | Response |
|---------|---------|----------|
| Yes/No | `Continue? (y/n)` | `y` |
| Numbered Selection | `1. Allow  2. Deny` | `1` |
| Bullet Selection | `● 1. Yes  ● 2. No` | `1` |
| Shell Prompt | `$ ` or `# ` | Ready for input |
| Question Mark | `Allow file edit?` | `y` |

### Practical Examples

#### Example 1: Claude Code File Edit Approval

```
Target Session (claude):
> Editing src/app.tsx
> File modification requires approval. Continue? (y/n)

Commander Session:
[5 seconds later...]
[auto-accept] Detected prompt, sending: y\n

Result: File edit approved automatically!
```

#### Example 2: Build Process with Confirmations

```
Target Session (build-script):
$ ./build.sh
Building project...
Clear build cache? (y/n)
Install new dependencies? (y/n)
Run tests? (y/n)

Commander Session:
[Auto-responds to all 3 prompts]
[Build completes unattended]
```

#### Example 3: Multi-Step Approval Workflow

```
Target Session (deploy):
$ npm run deploy
Deploying to staging? (1=yes, 2=no):
Run smoke tests? (1=yes, 2=no):
Deploy to production? (1=yes, 2=no):

Commander Session:
[Auto-selects option 1 for all three prompts]
[Deployment proceeds automatically]
```

### Advanced Features

#### Override Auto-Response

You can interrupt auto-accept by typing in the commander session:

1. Open the commander session terminal
2. Type your custom input
3. This resets the 30-second "user interrupt" timer
4. Auto-accept pauses while you actively use the session
5. Auto-accept resumes after 30 seconds of inactivity

#### Check Auto-Accept Status

From the command line:

```bash
curl http://localhost:4311/api/sessions/local:commander-claude/auto-accept
```

Response:
```json
{
  "commanderSessionId": "local:commander-claude",
  "enabled": true,
  "targetSessionId": "local:claude",
  "role": "commander"
}
```

#### Disable Auto-Accept

```bash
curl -X POST http://localhost:4311/api/sessions/local:commander-claude/auto-accept \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}'
```

### Troubleshooting

#### Auto-Respond Not Working

**Symptom:** Commander is created but doesn't respond to prompts

**Solutions:**
1. Check server logs for errors: `grep "auto-accept" logs/server.log`
2. Verify target session is actually showing a prompt
3. Check network connectivity between sessions
4. Confirm auto-accept is enabled: `curl .../auto-accept`

#### Commander Session Keeps Responding Wrong

**Symptom:** Commander sends 'y' when it should send '1'

**Solutions:**
1. The pattern detection is heuristic-based
2. Check if your prompt matches expected patterns
3. You can manually override by typing in commander session
4. Report the pattern to improve detection

#### Sessions Lost After Server Restart

**Symptom:** Commander sessions disappear when server restarts

**Behavior:** This is expected - links are runtime-only (not persisted to database)

**Solution:** Recreate commander sessions after restart, or implement persistence (future enhancement)

### Performance Considerations

- **Polling Interval:** 5 seconds (configurable in code)
- **Capture Overhead:** ~100ms per poll per session
- **Memory Usage:** ~1-2MB per active commander
- **Recommended Limit:** 5-10 simultaneous commanders

### Security Notes

- **No Automatic Dangerous Commands:** Commander only sends keys matching known prompt patterns
- **User Override:** Manual input always takes precedence
- **Timeout:** Auto-accept resets on user interaction
- **Session Isolation:** Commander can only affect its linked target

### API Reference

#### Create Commander Session

```bash
curl -X POST http://localhost:4311/api/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-commander",
    "command": "bash",
    "cwd": "/home/user",
    "templateName": "commander",
    "sessionRole": "commander",
    "linkedSessionId": "local:target-session"
  }'
```

#### Enable Auto-Accept

```bash
curl -X POST http://localhost:4311/api/sessions/local:my-commander/auto-accept \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": true,
    "targetSessionId": "local:target-session"
  }'
```

#### Get Auto-Accept Status

```bash
curl http://localhost:4311/api/sessions/local:my-commander/auto-accept
```

#### List All Sessions with Links

```bash
curl http://localhost:4311/api/sessions | jq '.sessions[] | {id, name, sessionRole, linkedSessionId}'
```

---

## 司令官Agent ユーザーガイド

### 司令官Agent とは？

司令官Agent は、任意のターゲットセッションに自律的な「司令官」セッションをアタッチできる機能です。司令官は自動的にプロンプトに応答し、長時間の操作中の手動操作の必要性を排除します。

**以下のような場面に最適：**
- Claude Code ファイル編集の権限確認プロンプト承認
- ビルドプロセスの yes/no 確認処理
- CI/CD ワークフローのルーチンな選択自動化
- AI agent セッションの無人運用

### 動作の仕組み

#### ステップバイステップの使い方

1. **Work OS ダッシュボードを開く**
   - http://localhost:4311 (またはあなたの Work OS インスタンス) にアクセス
   - 実行中の tmux セッションを表示

2. **ターゲットセッションを探す**
   - 司令官をアタッチしたいセッションを探す
   - コーディング agent（`claude`, `codex`, `gemini`）またはスクリプトなど

3. **「⚔️ 司令官を追加」ボタンをクリック**
   - セッションカード下部の右側にあります
   - モーダルダイアログが表示されます

4. **司令官を設定**
   - **司令官名**: ユニークな名前を入力（例：`commander-claude`, `approve-bot`）
   - **テンプレート**: 必要に応じて司令官テンプレートを選択（'commander' ロール用にフィルター）
   - **起動** をクリック

5. **セッションを監視**
   - 新しい司令官セッションがダッシュボードに表示される
   - 司令官セッションに `⚔️ Commander` バッジが表示される
   - ターゲットセッションに `🎯 Watched by: {司令官名}` バッジが表示される

6. **自動応答が自動的に実行される**
   - ターゲットセッションがプロンプトを表示すると、司令官が約5秒で応答
   - サーバーログで確認：`[auto-accept] Detected prompt, sending: y\n`

#### 自動応答パターン

司令官は自動的に以下のパターンを検出して応答します：

| パターン | 例 | 応答 |
|----------|-----|------|
| Yes/No | `続行しますか? (y/n)` | `y` |
| 番号選択 | `1. 許可  2. 拒否` | `1` |
| 箇条書き選択 | `● 1. はい  ● 2. いいえ` | `1` |
| シェルプロンプト | `$ ` または `# ` | 入力準備完了 |
| 疑問符 | `ファイル編集を許可？` | `y` |

### 実践例

#### 例1: Claude Code ファイル編集承認

```
ターゲットセッション (claude):
> src/app.tsx を編集中
> ファイル変更は承認が必要です。続行しますか? (y/n)

司令官セッション:
[5秒後...]
[auto-accept] Detected prompt, sending: y\n

結果：ファイル編集が自動承認される！
```

#### 例2: 確認付きビルドプロセス

```
ターゲットセッション (build-script):
$ ./build.sh
プロジェクトをビルド中...
ビルドキャッシュをクリア? (y/n)
新しい依存関係をインストール? (y/n)
テストを実行? (y/n)

司令官セッション:
[3つのプロンプトすべてに自動応答]
[ビルドが無人で完了]
```

#### 例3: マルチステップ承認ワークフロー

```
ターゲットセッション (deploy):
$ npm run deploy
ステージングにデプロイ? (1=yes, 2=no):
スモークテストを実行? (1=yes, 2=no):
本番環境にデプロイ? (1=yes, 2=no):

司令官セッション:
[3つのプロンプトすべてでオプション1を自動選択]
[デプロイが自動的に進行]
```

### 高度な機能

#### 自動応答をオーバーライド

司令官セッションに入力することで自動承認を中断できます：

1. 司令官セッションのターミナルを開く
2. カスタム入力を入力
3. 30秒の「ユーザー割込」タイマーがリセットされる
4. アクティブに使用している間は自動承認が一時停止
5. 30秒の非アクティブ時間後に自動承認が再開

#### 自動承認ステータスを確認

コマンドラインから：

```bash
curl http://localhost:4311/api/sessions/local:commander-claude/auto-accept
```

レスポンス：
```json
{
  "commanderSessionId": "local:commander-claude",
  "enabled": true,
  "targetSessionId": "local:claude",
  "role": "commander"
}
```

#### 自動承認を無効化

```bash
curl -X POST http://localhost:4311/api/sessions/local:commander-claude/auto-accept \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}'
```

### トラブルシューティング

#### 自動応答が機能しない

**症状**: 司令官が作成されるが、プロンプトに応答しない

**解決方法:**
1. サーバーログでエラーを確認：`grep "auto-accept" logs/server.log`
2. ターゲットセッションが実際にプロンプトを表示しているか確認
3. セッション間のネットワーク接続を確認
4. 自動承認が有効か確認：`curl .../auto-accept`

#### 司令官セッションが間違った応答をし続ける

**症状**: 司令官が `y` を送信する必要があるときに `1` を送信する

**解決方法:**
1. パターン検出はヒューリスティックベース
2. プロンプトが期待されるパターンに合致しているか確認
3. 司令官セッションに入力して手動でオーバーライド可能
4. パターンを改善するため報告してください

#### サーバー再起動後にセッションが失われる

**症状**: サーバー再起動後に司令官セッションが表示されない

**動作**: これは予期された動作です - リンクはランタイムのみ（データベースに永続化されない）

**解決方法**: サーバー再起動後に司令官セッションを再作成するか、永続化を実装してください（将来の拡張）

### パフォーマンス考慮事項

- **ポーリング間隔**: 5秒（コードで設定可能）
- **キャプチャオーバーヘッド**: セッションあたり約100ms
- **メモリ使用量**: アクティブな司令官あたり約1-2MB
- **推奨限界**: 同時に5〜10の司令官

### セキュリティに関する注意

- **自動危険コマンドなし**: 司令官は既知のプロンプトパターンに合致するキーのみ送信
- **ユーザーオーバーライド**: 手動入力は常に優先される
- **タイムアウト**: ユーザー操作時に自動承認がリセット
- **セッション分離**: 司令官はリンクされたターゲットのみに影響可能

### API リファレンス

#### 司令官セッションを作成

```bash
curl -X POST http://localhost:4311/api/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-commander",
    "command": "bash",
    "cwd": "/home/user",
    "templateName": "commander",
    "sessionRole": "commander",
    "linkedSessionId": "local:target-session"
  }'
```

#### 自動承認を有効化

```bash
curl -X POST http://localhost:4311/api/sessions/local:my-commander/auto-accept \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": true,
    "targetSessionId": "local:target-session"
  }'
```

#### 自動承認ステータスを取得

```bash
curl http://localhost:4311/api/sessions/local:my-commander/auto-accept
```

#### リンク付きのすべてのセッションをリスト表示

```bash
curl http://localhost:4311/api/sessions | jq '.sessions[] | {id, name, sessionRole, linkedSessionId}'
```
