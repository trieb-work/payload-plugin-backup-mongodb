# Changesets

This folder is used by [Changesets](https://github.com/changesets/changesets) to version and publish this package.

- Add a changeset for user-facing changes: `pnpm changeset`
- Merge a PR to `main` with changeset files: the [Release](.github/workflows/release.yml) workflow opens a “version packages” PR or publishes to npm when versions are ready.

For PRs, CI expects a new `.changeset/*.md` unless you add the `no-changeset` label (docs-only, internal chore).

See [our documentation](https://github.com/changesets/changesets/blob/main/docs/intro-to-using-changesets.md).
