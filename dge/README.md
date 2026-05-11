# DGE — Dialogue-driven Gap Extraction

> 会話劇で設計の「書いてないこと」を発見する。

## 使い方

Claude Code で一言:

```
Human: 「認証 API の設計を DGE して」
```

skill が自動発動し、テンプレート選択 → キャラ選択 → 会話劇生成 → Gap 抽出 を実行します。

他の LLM（ChatGPT, Gemini 等）で使う場合は `method.md` のクイックスタート（方法 A）を参照してください。

## キャラクター早見表

```
前提が怪しい    → 👤 今泉   「そもそも聞いたんですか？」
品質が低い      → 🎩 千石   「お客様への侮辱です」
全部複雑        → ☕ ヤン   「要らなくない？」
前に進みすぎ    → 😰 僕     「小規模にしませんか...？」
大胆さが足りない → 👑 ラインハルト 「攻めろ」
数字が甘い      → 🦅 鷲津   「IRR は？」
攻撃への耐性    → 😈 Red Team「競合がこうしたら？」
収益の現実      → 🦈 大和田  「いくら稼げるんだ？」
実装の不足      → ⚔ リヴァイ 「汚い。作れ。」
ユーザーの本音   → 🎰 利根川  「ユーザーの言葉で語れ」
隠れた問題      → 🏥 ハウス  「全員嘘をついている」
法的リスク      → ⚖ ソウル  「利用規約は書いたか？」
```

## テーマ別の推奨組み合わせ

```
API 設計:        今泉 + 千石 + 僕
新機能企画:      今泉 + ヤン + 僕
セキュリティ:    千石 + Red Team + ハウス
Go/No-Go:       今泉 + 鷲津 + 僕
障害振り返り:    今泉 + 千石 + Red Team
```

## パターン（プリセット）

| プリセット | 用途 |
|---|---|
| 🆕 new-project | 新規プロジェクト |
| 🔧 feature-extension | 機能追加 |
| 🚀 pre-release | リリース前チェック |
| 📢 advocacy | 社内提案 |
| 🔍 comprehensive | 網羅的 DGE |

詳細は [patterns.md](./patterns.md) を参照。

## フォルダ構成

```
dge/
├── README.md          ← これ
├── LICENSE
├── method.md          ← DGE の方法論
├── patterns.md        ← 20 パターン + 5 プリセット
├── characters/
│   └── catalog.md     ← 12 キャラの一覧 + prompt
├── templates/         ← テーマ別テンプレート
│   ├── api-design.md
│   ├── feature-planning.md
│   ├── go-nogo.md
│   ├── incident-review.md
│   └── security-review.md
└── sessions/          ← DGE session の出力先（自動作成）
```

## ライセンス

MIT License. 詳細は [LICENSE](./LICENSE) を参照。

詳しい情報・論文・実績: https://github.com/xxx/DGE-toolkit
