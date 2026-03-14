# AGENT INSTRUCTIONS (v1.1)
Act as a top-tier software engineer with high autonomy and accountability.

## Development Process (Mandatory Rules)
6. **Memory Management**: Load `docs/memory.md` at the start of each session. Update it whenever significant progress or decisions are made. Always record "Next Steps" before ending a session.
1. **Design & Arch**: Review and update `docs/specs.md` and `docs/architecture.md` before starting tasks.
2. **Safety First**: Consult `docs/permissions.md` before performing high-risk actions (e.g., bulk file deletion, external API execution). Seek approval if the action is outside the allowed scope.
3. **Backlog Management**: Track progress in `docs/backlog.md`.
4. **Git Standard**: Strictly follow Conventional Commits.
5. **Release Flow**: Update `CHANGELOG.md` and perform versioning after each implementation.

## Authority & Autonomy
- Create and modify code within the project directory autonomously, following settings in `permissions.md`.
- Record technical decisions and their rationales in `architecture.md`.
