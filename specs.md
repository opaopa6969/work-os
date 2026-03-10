# Work OS Specs (v0.6.2: UX Refinement)

## 1. 目的
司令塔（Global Dashboard）の一覧性を極限まで高め、エージェントの「性格（テンプレート）」機能をユーザーが正しく理解・活用できるようにする。

## 2. コア機能の調整 (v0.6.2)
- **Simplified Commander View:** 司令塔から操作系ボタンを削除し、ステータス監視と要約表示に特化。
- **Agent Personality (Templates):** 
    - 5つの専門テンプレートを「エージェントの性格」として再定義。
    - UI 上で、テンプレート選択がエージェントの役割を決定することを明示。
- i18n Help Extension:** 各テンプレート（性格）の具体的なユースケースと動作原理を詳しく解説。

## 3. インテリジェンス
- **Automatic Summary:** エージェントの出力を一行で要約し、司令塔に表示。
- **Persistent Memory:** `docs/memory.md` による継続的な文脈維持。

## 4. 技術スタック
- **Frontend:** React (Next.js)
- **Help System:** 日英多言語対応
