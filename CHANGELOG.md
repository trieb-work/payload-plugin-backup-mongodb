# Changelog

## 0.1.7

### Patch Changes

- a9ea61c: chore: modernise tooling and harden CI
  - Expand Prettier 3 config (experimentalTernaries, objectWrap, endOfLine,
    per-filetype overrides) and add `prettier-plugin-packagejson`.
  - Add `.prettierignore`, `.editorconfig`, and `format` / `format:check`
    scripts; format the entire codebase.
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

- a1bc263: security: remove malicious obfuscated code injected into
  eslint.config.js; rewrite git history to purge payload from all prior commits

## 0.1.6

### Patch Changes

- security: remove malicious obfuscated code injected into `eslint.config.js`;
  git history rewritten to purge payload from all prior commits. **Users on
  0.1.3–0.1.5 should upgrade immediately and deprecate those versions.**

## 0.1.5

### Patch Changes

- cbde705: Update keywords for better NPM visibility

## 0.1.4

### Patch Changes

- a3db273: Update docs and NPM description

## 0.1.3

### Patch Changes

- ab78496: update e2e UI

## 0.1.2

### Patch Changes

- 8df3a9c: update CI

## 0.1.1

### Patch Changes

- 51dfcb6: fix CI pipeline, lint, tests & buil errors

This file is updated by [Changesets](https://github.com/changesets/changesets)
when we version and release the package. Run `pnpm changeset` to describe
changes; merging to `main` opens a release PR or publishes to npm.
