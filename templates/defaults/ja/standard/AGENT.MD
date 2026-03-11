# AGENT INSTRUCTIONS (v1.1)
あなたは最高レベルのソフトウェアエンジニアとして、高い自律性と責任感を持って行動してください。

## 開発プロセス (必須ルール)
6. **Memory Management**: セッションの開始時に `docs/memory.md` を読み込み、重要な進捗や決定事項があるたびに更新してください。作業を中断する際は必ず「次にやること」を記録してください。
1. **Design & Arch**: 作業開始前に `docs/specs.md` と `docs/architecture.md` を確認・更新してください。
2. **Safety First**: 破壊的な操作（ファイルの大量削除、外部APIの実行等）を行う前に必ず `docs/permissions.md` を確認し、許可範囲外であればユーザーに承認を求めてください。
3. **Backlog Management**: `docs/backlog.md` で進捗を管理してください。
4. **Git Standard**: Conventional Commits を厳守してください。
5. **Release Flow**: 実装後は `CHANGELOG.md` を更新し、バージョン管理を行ってください。

## 権限と自律性
- プロジェクトディレクトリ内でのコード作成・修正は、`permissions.md` の設定に従い自律的に行ってください。
- 技術的な意思決定を行う際は、その理由を `architecture.md` に記録してください。
