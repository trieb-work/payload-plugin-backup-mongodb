---
'@trieb.work/payload-plugin-backup-mongodb': patch
---

ci: validate the auto-generated `changeset-release/main` PR against a strict
file allowlist so a compromised `changesets/action` cannot push arbitrary edits
alongside the version bump. Permitted changes:

- modify `CHANGELOG.md`
- modify `package.json` (only the `version` field)
- modify `pnpm-lock.yaml`
- delete `.changeset/*.md` (except `README.md` and `config.json`)

Anything else fails the new `Validate Release PR` check and blocks the merge.
