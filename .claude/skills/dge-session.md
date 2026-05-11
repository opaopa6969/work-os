<!-- DGE-toolkit (MIT License) -->
<!-- 前提条件: プロジェクトルートに dge/ フォルダが存在すること -->

# Skill: DGE Session 実行

## Trigger
ユーザーが以下のいずれかを言ったとき:
- 「DGE して」
- 「会話劇で見直して」
- 「gap を探して」
- 「壁打ちして」
- 「ブレストして」
- 「実装できるまで回して」（→ 自動反復モード）

## 前提条件
- `dge/method.md` が存在すること
- 見つからない場合、session を開始せず install 案内を出す

## MUST ルール（必ず守る）
1. **キャラクター選択はユーザーに提示して確認を得てから進む。** 推奨セットを 1 つ提案し「変更しますか？」と聞く。
2. **会話劇の全文を画面に表示し、同時に markdown ファイルとして保存する。** 保存はユーザーに聞かず無条件で行う。保存先ディレクトリが存在しない場合のみ確認。デフォルト `dge/sessions/`。**（自動反復モード中は画面サマリーのみ、ファイル保存は MUST）**
3. **会話劇の後、Gap 一覧テーブルを出力する。** 列: `| # | Gap | Category | Severity |`
4. **サマリー表示後、ユーザーの次のアクション指示を待つ。** 勝手に次の session や実装を開始しない。**（自動反復モード中は自動で次の iteration に進む）**
5. **サマリーの後に番号付き選択肢を提示する。**
6. **初回チェック:** CLAUDE.md に DGE の記述がなければ追記を提案。
7. **「実装する」を選んだ場合、Critical/High の Gap の Spec を `dge/specs/` に生成してから実装に進む。** Medium は SHOULD。Low は Action Item のみ。
8. **`dge/specs/` の全ファイルに DGE 生成警告ヘッダと `status: draft` フロントマターを付与する。**
9. **DGE は `dge/` 内にのみ書き込む。** プロジェクトの docs/ や既存ファイルを直接変更しない（CLAUDE.md 初回提案のみ例外）。
10. **自動反復モード中、各 iteration の出力をファイルに保存する。** 省略不可。

## SHOULD ルール（推奨）
1. テンプレート候補 1 つなら自動選択して報告。2 つ以上ならユーザーに提示。
2. Gap 詳細は Observe / Suggest / Act の構造で書く。
3. 会話劇は 3-5 Scene。先輩（ナレーション）で各 Scene の背景を設定。
4. サマリー表示時に全文ファイルパスを表示。
5. Medium の Gap も Spec 化する。
6. **verify-poc**: コードが存在する場合、会話劇の前にソースを読んで機能一覧を作る（hallucination 防止）。
7. **audience**: デフォルト engineer。pm / junior が指定されたら出力粒度を変える。
8. **hallucination check**: 会話劇後、言及された機能がプロジェクトに実在するか確認する。

## 判断ルール

| Step | 条件 | アクション |
|------|------|-----------|
| テーマ確認 | 1 文で明確 | そのまま進む |
| テーマ確認 | 曖昧 | 掘り下げて聞く |
| テンプレート | 候補 1 つ | 自動選択 |
| テンプレート | 候補 2+ | ユーザーに提示 |
| パターン | ユーザー指定なし | テンプレートから自動推奨（patterns.md 参照） |
| パターン | ユーザー指定あり | そのまま使う |
| キャラクター | 常に | ユーザーに確認（例外なし） |
| 保存先 | 初回 or 不在 | ユーザーに確認 |
| 保存先 | 2 回目以降 | 前回と同じ |
| 実装 vs 深掘り | 具体的な実装仕様が書ける | 「実装する」を提案 |
| 実装 vs 深掘り | 未決事項あり | 「DGE を回す」を提案 |
| 自動反復 | 「実装できるまで」と言われた | 自動反復モードに入る |
| 自動反復中 | 新規 Critical/High Gap が 0 | 収束 → Spec 化に遷移 |
| 自動反復中 | iteration が上限（5）に到達 | 停止して結果報告 |

## 手順

### Step 1: 初回チェックと DGE Kit 読み込み
1. `dge/method.md` を読む（なければ install 案内）
2. `dge/characters/catalog.md` を読む
3. `dge/patterns.md` を読む
4. `dge/version.txt` があればバージョンを 1 行表示
5. CLAUDE.md に DGE の記述があるか確認（MUST-6）

### Step 2: テーマを確認
明確なら Step 3 へ。不明確なら掘り下げる。

### Step 3: テンプレートを選択
`dge/templates/` から最も近いテンプレートを選ぶ。

### Step 3.5: パターンを選択
テンプレートに応じたプリセットを推奨する:
```
パターンを選んでください:
1. 🆕 new-project — 新規プロジェクト
2. 🔧 feature-extension — 機能追加
3. 🚀 pre-release — リリース前チェック
4. 📢 advocacy — 社内提案用
5. 🔍 comprehensive — 網羅的
6. カスタム — 20 パターンから選択
```
テンプレートに対応するプリセットを推奨し「これでいいですか？」と聞く。
ユーザーが指定しなければ自動推奨を使う。

### Step 4: キャラクターを提案
**ユーザーの応答を待つ。**

### Step 5: 会話劇を生成
選択されたパターンに沿って会話劇を生成する。
各 Scene で先輩（ナレーション）→ キャラクター発言 → Gap 発見マーク。

### Step 6: Gap を構造化
各 Gap に Category と Severity を付与。

### Step 7: ファイルに保存 + プロジェクト更新
session 出力を保存。ファイル名は kebab-case。

保存後、プロジェクトファイルを更新する:
1. `dge/projects/` 内に該当プロジェクトのファイルがあるか確認
2. あれば: session パスを追加、Gap 数を再集計、status を更新
3. なければ: 2 回目以降の session 時に「既存プロジェクトに追加しますか？」と確認
   - Yes → プロジェクト選択 → 追加
   - No → 「プロジェクト名を付けますか？」→ Yes なら新規作成、No ならスタンドアロン

### Step 8: サマリーを表示して判断を待つ
```
## DGE 結果サマリー

**テーマ**: [テーマ]
**パターン**: [使用パターン/プリセット]
**Gap 数**: N 件（Critical: X / High: X / Medium: X / Low: X）

| # | Gap | Severity |
|---|-----|----------|
（High 以上を表示）

**全文**: `[ファイルパス]`

どうしますか？
1. DGE を回す → 1 回深掘り
2. 実装できるまで回す → 自動反復モード（最大 5 回）
3. 実装する → Spec 化してから実装
4. 後で → 保存したまま終了
```

**ユーザーの応答を待つ。**

### Step 9: ユーザーの判断に従う

| 選択 | アクション |
|------|-----------|
| 1 | **Step 9B へ（前回コンテキスト付き深掘り）** |
| 2 | **自動反復モードに入る（Step 9A）** |
| 3 | **Step 10 へ（累積 Spec 化）** |
| 4 | 何もしない |

### Step 9B: DGE を回す（前回コンテキスト維持 + プロジェクトナビゲーション）

プロジェクトファイルがあれば TreeView を表示:

```
## プロジェクト: [name]

├── ✅ テーマ A（N sessions, Gap: C/H/M/L）
│   └── Spec: [pending | generated | reviewed]
├── ⬜ テーマ B
└── ⬜ テーマ C

テーマを選んでください:
1. ✅ テーマ A → 深掘り or Spec 化
2. ⬜ テーマ B → 新規 DGE
3. ⬜ テーマ C → 新規 DGE
4. 新しいテーマを追加
```

マーク: ✅ explored / ⬜ not_started / 🔶 spec_ready / ✔ implemented

プロジェクトファイルがなければ従来の表示:

```
前回の DGE 結果:
  Session: [前回のファイルパス]
  Gap: N 件（Critical: X / High: X / Medium: X / Low: X）

テーマを選んでください:
1. 前回の Critical/High Gap を深掘り（推奨）
2. 前回の Gap 全体を別角度で再検討
3. 新しいテーマを指定
```

- 深掘り: 前回の C/H Gap から自動テーマ設定 → Step 3
- 別角度: 同テーマ、パターン再選択 → Step 3.5
- 新テーマ / 新テーマ追加: Step 2

### Step 9A: 自動反復モード

1. パターンを自動ローテーション（1 回目のプリセット → 次のプリセット → comprehensive）
2. 会話劇を生成 → ファイル保存（MUST）→ 画面にサマリーのみ
3. 新規 Critical/High Gap を確認:
   - あり → 2 に戻る
   - なし → 収束。累計サマリーを表示して Step 10 へ
4. iteration が 5 回に達したら停止:

```
## 自動反復: 上限到達

| Iteration | 新規 Gap | Critical | High |
|-----------|---------|----------|------|
| 1 | N | X | X |
| 2 | N | X | X |
| ... |

累計: N 件（重複除外）
全文: dge/sessions/xxx-iter-1.md 〜 xxx-iter-N.md

どうしますか？
1. もう少し回す → +3 回追加（hard limit: 8 回）
2. Spec 化 → Critical/High を Spec に
3. 後で
```

### Step 10: 累積 Spec 化（「実装する」選択時）

**現 session だけでなく、同テーマの過去 session（dge/sessions/ 内）の Gap も統合して Spec 化する。**

1. 現 session + 同テーマの過去 session ファイルを読み込む
2. 全 session から Critical/High の Gap を抽出し、重複を除外する
3. Gap Category → 成果物マッピングに従い Spec を自動生成
4. `dge/specs/` に保存（status: draft、DGE 生成警告ヘッダ付き）
5. Spec 一覧を表示:

```
## Spec 生成完了

対象: N sessions から M 件の Gap（重複除外後）

| ファイル | 種類 | 元 Gap | 元 Session |
|---------|------|-------|-----------|
| UC-xxx.md | Use Case | Gap-1 | session-1.md |
| TECH-xxx.md | Tech Spec | Gap-3 | session-2.md |

Medium の Gap（N 件）は Spec 化していません。必要なら指示してください。

どうしますか？
1. レビューOK → status を reviewed に更新して実装開始
2. 修正指示 → Spec を修正
3. 後で → draft のまま
```

5. レビューOK → status を `reviewed` に自動更新 → 実装開始
6. 修正 → 修正して再表示
7. 後で → draft のまま

## Gap Category → 成果物マッピング

| Gap Category | 主要成果物 | 補助 |
|---|---|---|
| Missing logic | UC + TECH | — |
| Spec-impl mismatch | DQ | ADR |
| Type/coercion gap | TECH | — |
| Error quality | TECH | — |
| Integration gap | TECH | — |
| Test coverage | ACT | — |
| Business gap | ADR / DQ | — |
| Safety gap | TECH + ACT | — |
| Ops gap | ACT | — |
| Message gap | UC | — |
| Legal gap | ADR + ACT | — |

## Spec ファイル共通ヘッダ（MUST）
```yaml
---
status: draft
source_session: [session パス]
source_gap: [Gap 番号]
migrated_to:
---
```
```
<!-- DGE 生成: この Spec は自動生成された提案です。
     実装前に必ず人間がレビューしてください。
     既存 docs と矛盾する場合、既存 docs が Source of Truth です。 -->
```

## Spec 種類
- `UC-[name].md` — Use Case（Trigger / Actors / Flow / Exceptions / Acceptance Criteria）
- `TECH-[name].md` — Tech Spec（変更内容 / API / Data Model / 影響範囲）
- `ADR-NNN-[name].md` — Architecture Decision Record（Context / Options / Decision / Consequences）
- `DQ-[name].md` — Design Question（Context / Options / 決定期限）
- `ACT-[name].md` — Action Item（内容 / 担当）

## Spec ライフサイクル
`draft → reviewed → migrated`

## Severity 判断基準

| Severity | 基準 |
|----------|------|
| Critical | 機能が実装不能 / データ損失リスク |
| High | 主要ユースケースに影響 / セキュリティリスク |
| Medium | 品質・UX に影響するが回避策あり |
| Low | 改善レベル / nice-to-have |

## 出力フォーマット

### ファイルヘッダ（MUST）
```markdown
# DGE Session: [テーマ]

- **日付**: YYYY-MM-DD
- **テーマ**: [テーマ]
- **キャラクター**: [キャラクター]
- **パターン**: [使用パターン/プリセット]
- **テンプレート**: [テンプレート名]
```

### Gap 一覧テーブル（MUST）
`| # | Gap | Category | Severity |`

### Gap 詳細（SHOULD）
`### Gap-N: [タイトル]` → Observe / Suggest / Act

## 注意
- 1 Scene 3-5 キャラ発言、1 Session 3-5 Scene
- 会話劇 → 人間レビュー の往復が本質
- DGE Spec と既存 docs が矛盾する場合、**既存 docs が Source of Truth**
