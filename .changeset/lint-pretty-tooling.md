---
'@trieb.work/payload-plugin-backup-mongodb': patch
---

chore: modernise tooling and harden CI

- Expand Prettier 3 config (experimentalTernaries, objectWrap, endOfLine,
  per-filetype overrides) and add `prettier-plugin-packagejson`.
- Add `.prettierignore`, `.editorconfig`, and `format` / `format:check` scripts;
  format the entire codebase.
- VS Code workspace: enable format-on-save globally for
  TS/JS/JSON/MD/YAML/CSS/SCSS, enforce LF line endings, recommend the
  EditorConfig extension.
- ESLint: include `playwright.config.ts` in the project service and ignore the
  auto-generated `backupDashboardInlineCss.ts`.
- GitHub Actions: enforce `pnpm install --frozen-lockfile --ignore-scripts`
  followed by `pnpm rebuild` (allowlisted via `pnpm.onlyBuiltDependencies`)
  across CI, release, e2e, and dev-deploy workflows so third-party install
  scripts cannot run with secrets in scope. CI now also runs `format:check`.
- Trim the husky pre-push hook to typecheck + lint (integration tests already
  run in CI).
