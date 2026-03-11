# 高度な開発テンプレート (Pro+)
設計・技術アーキテクチャ・権限管理・リリースフローを網羅した、最高峰の開発環境テンプレートです。

## 内容
- `docs/specs.md`: 機能定義（何を作るか）。
- `docs/architecture.md`: 技術設計（どう作るか、データ構造、コンポーネント）。
- `docs/permissions.md`: 権限管理（エージェントへの許可事項、自動承認の範囲）。
- `docs/backlog.md`: タスク管理。
- `CHANGELOG.md`: 変更履歴。
- `AGENT.MD`: 全てのドキュメントを読み込み、自律的に動くための最高指示。

## エージェントの動き
1. `specs.md` で要件を整理し、`architecture.md` で実装方針を固める。
2. `permissions.md` を確認し、自分が許されている行動範囲を理解する。
3. `backlog.md` に基づき、Conventional Commits を守りながら実装を進める。
