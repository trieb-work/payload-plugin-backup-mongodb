# Test coverage plan — `@trieb.work/payload-plugin-backup-mongodb`

Living checklist of tests we want for every behaviour the plugin ships. Items are grouped by priority so the next agent picking this up can see at a glance what's critical, what's nice-to-have, and what is already covered. Check items off as they are implemented.

## Layout

- `tests/unit/` — pure function tests, run with `pnpm test:int` (vitest).
- `tests/integration/` — endpoint / flow tests with mocked `@vercel/blob` + in-memory Payload or mocked payload object. Run with `pnpm test:int`.
- `tests/e2e/` — Playwright end-to-end tests against the `dev/` Payload+Next app. Run with `pnpm test:e2e`.
- `dev/int.spec.ts` — boots the real in-memory dev app and asserts collections + endpoints are registered; complements the integration folder with one real-world smoke test.

## Priority legend

- **P1 — very important** — core data-loss / security / release-blocking behaviour. Must exist.
- **P2 — medium** — covers non-trivial helpers, the admin UI shell, or auxiliary endpoints. Should exist.
- **P3 — less important** — polish, rare edge cases, visual/UI niceties.

---

## P1 — very important (must have)

### Core backup / restore logic (unit + integration)

- [x] `createBackup` writes a `manual---…` json blob with the correct name shape (`tests/integration/backup.test.ts`).
- [x] `createBackup` uses the `cron---` prefix and prunes older cron archives when `backupsToKeep` is exceeded.
- [x] `createBackup` includes / skips collections based on `skipCollections`.
- [x] `createBackup` sanitizes + encodes the manual backup label; label is ignored for cron.
- [x] `createBackup` throws for non-mongoose adapters and uninitialized DBs.
- [x] `createMediaBackupFile` produces a valid gzip/tar archive and warns on missing files.
- [x] `restoreBackup` fetches JSON backups and upserts every collection.
- [x] `restoreBackup` respects the collection blacklist and always injects `backup-tasks` when a `taskId` is present (progress polling must survive restore).
- [x] `restoreBackup` honours `mergeData: true` (no `deleteMany`).
- [x] `restoreBackup` uses unique indexes in the upsert filter so per-field uniqueness is preserved.
- [x] `restoreBackup` rejects unsupported file types.
- [x] `listBackups` resolves the token via settings + env and returns `[]` when no token can be derived.
- [x] `archive` round-trip: create + resolve tar.gz preserves binary content and names.

### Blob storage abstraction (integration)

- [x] `putBackupBlobContent` retries with the other access level when the store rejects the preferred one, and re-throws non-access errors.
- [x] `readBackupBlobContent` / `readBackupBlobContentFlexible` attaches `Authorization: Bearer` for Vercel Blob hosts only; falls back to anonymous fetch for non-blob URLs.
- [x] `streamBackupBlobForDownload` streams the trusted `downloadUrl` and preserves literal `%2F` inside pathnames; refuses untrusted hosts.
- [x] `isTrustedBackupBlobReference` / `vercelBlobPathnameFromUrl` accept Vercel Blob HTTPS hosts only.
- [x] `validateBackupBlobToken` probes the store, detects public vs private, cleans up probe blob, rejects empty tokens + non-access errors.

### Cron / external endpoints (integration)

- [x] Cron routes are registered under `/backup-mongodb/cron/*` with the right HTTP methods.
- [x] `GET /cron/run` → 503 when no blob token, 401 when bearer is wrong, 202 + queues `createBackup` when auth + env are valid.
- [x] `GET /cron/list` → 401 for wrong bearer, 503 when no token, 200 + blob array on success. _(new — `tests/integration/cronListEndpoint.test.ts`)_
- [x] `POST /cron/restore` → 401 for wrong bearer, 400 for missing / invalid url, 202 + calls `restoreBackup` on success. _(new — `tests/integration/cronRestoreEndpoint.test.ts`)_

### Admin endpoints — authentication & authorization (integration)

- [x] Every admin endpoint returns **401** when no authorized backup admin is present (`requireBackupAdmin`). _(new — `tests/integration/adminEndpointAuth.test.ts`)_
- [x] Admin endpoints fall back to `pollSecret` auth for `GET /admin/task/:id` even for anonymous callers. _(new — `tests/integration/adminTaskEndpoint.test.ts`)_
- [x] `PAYLOAD_BACKUP_ALLOWED_ROLES` env var and the `access` plugin option both gate the admin endpoints _(unit coverage in `tests/unit/dashboardRoleAccess.test.ts` + integration happy/sad path via auth test)_.

### Admin endpoints — happy paths (integration)

- [x] `POST /admin/manual` → 503 w/o token, 400 shape issues, 202 + createBackup queued on success (label sanitized, `includeMedia` + `skipCollections` propagated, `media` skip disables `includeMedia`). _(new — `tests/integration/adminManualEndpoint.test.ts`)_
- [x] `POST /admin/restore` → rejects missing/invalid URL, injects `backup-tasks` into blacklist, propagates `restoreArchiveMedia`, requires `pathname` for private stores. _(new — `tests/integration/adminRestoreEndpoint.test.ts`)_
- [x] `POST /admin/delete` → rejects missing `url`/`pathname`, queues a delete task, calls `del()` with resolved token. _(new — `tests/integration/adminDeleteEndpoint.test.ts`)_
- [x] `GET /admin/task/:id` → 404 for unknown, pollSecret (query or bearer) accepted, admin fallback works, `pollSecret` is stripped from the response. _(new — `tests/integration/adminTaskEndpoint.test.ts`)_
- [x] `GET/PATCH /admin/settings` → returns masked token, clamps `backupsToKeep`, re-validates rotated tokens, preserves stored token on masked submits, fails with 422 when a new token is rejected. _(new — `tests/integration/adminSettingsEndpoint.test.ts`)_
- [x] `POST /admin/validate-blob-token` → returns 200 + `{ok, access}` for valid tokens, 422 for invalid. _(new — `tests/integration/adminValidateBlobTokenEndpoint.test.ts`)_

### Task progress (unit)

- [x] `pollSecretsMatch` is timing-safe and rejects unequal / missing secrets.
- [x] `stripPollSecretForClient` scrubs `pollSecret`.

### Plugin registration (unit + in-memory integration)

- [x] The plugin registers `backup-tasks` + `backup-settings` collections and the `/backup-mongodb/*` endpoints (`dev/int.spec.ts`).
- [x] The plugin seeds a default settings document on first boot (`dev/int.spec.ts`).
- [x] `enabled: false` leaves the host config untouched (no collections / no endpoints added). _(new — `tests/unit/plugin.test.ts`)_
- [x] `afterDashboard` injects exactly one BackupDashboard entry without replacing existing afterDashboard components. _(new — `tests/unit/plugin.test.ts`)_

### End-to-end (Playwright, against `dev/`)

E2E scope covers UI rendering, dialog open/close flows, form loading, client-side
filtering, and the graceful 503 surfacing when a blob action is rejected. Tests are
**environment neutral** — the dev app runs with or without `BLOB_READ_WRITE_TOKEN`,
so any assertion that depends on a specific backend response is made deterministic
via Playwright `page.route()` mocks instead of depending on the real blob store.

Baseline (already covered before this pass):

- [x] Login and see the Payload admin dashboard (`tests/e2e/admin.spec.ts`).
- [x] The `Backups` block is rendered below the dashboard after login (`tests/e2e/backup-dashboard.spec.ts`).
- [x] `posts` collection is reachable after login (`tests/e2e/admin.spec.ts`).

Newly covered P1 (must-have) user flows:

- [x] **P1** — Dashboard toolbar renders the `Total` + `Last backup` pills regardless of how many backups exist (`tests/e2e/backup-dashboard.spec.ts`).
- [x] **P1** — Dashboard toolbar exposes both action buttons (`Create manual Backup`, `Backup settings`) (`tests/e2e/backup-dashboard.spec.ts`).
- [x] **P1** — The `Backup list` Collapsible header is rendered below the toolbar (`tests/e2e/backup-dashboard.spec.ts`).
- [x] **P1** — Dashboard renders either the "Add a Vercel Blob read/write token" setup hint **or** the connected-state toolbar depending on env (`tests/e2e/backup-dashboard.spec.ts`).
- [x] **P1** — Manual backup dialog opens from the toolbar, loads the collection preview (mocked via `page.route`), exposes the optional label field, and closes via Cancel (`tests/e2e/manual-backup-dialog.spec.ts`).
- [x] **P1** — Manual backup dialog surfaces a "Service unavailable" message when the `/admin/manual` endpoint returns 503 (mocked via `page.route`) (`tests/e2e/manual-backup-dialog.spec.ts`).
- [x] **P1** — Backup settings modal opens, renders the schedule + retention + token sections with a mocked settings payload, and closes via Cancel (`tests/e2e/backup-settings-modal.spec.ts`).
- [x] **P1** — Backup list Collapsible expands on click, opens the Filters dialog (label + date + media + source controls), and Done + Clear filters both work (`tests/e2e/backup-list-filters.spec.ts`).

Env-gated roundtrip coverage (run automatically when `BLOB_READ_WRITE_TOKEN` is set):

- [x] **P2** — Full manual backup create → restore roundtrip through the UI: open the
      Create manual Backup dialog, label it, wait for the `Done` status pill, assert the
      row lands in the backup list, open its Restore dialog, deselect auth-session
      collections, wait for `Done`, then clean up by clicking Delete and confirming. Skips
      automatically when no blob token is configured. _(new — `tests/e2e/backup-create-restore.spec.ts`)_
- [x] **P2** — Cron API roundtrip: `GET /api/backup-mongodb/cron/run` with the
      `CRON_SECRET` bearer, poll `/cron/list` until the fresh `cron-` blob shows up,
      then open the admin dashboard and assert the new entry is rendered as a
      `Cron backup` row. Cleans up via `POST /admin/delete` to keep the bucket tidy.
      Skips when either `BLOB_READ_WRITE_TOKEN` or `CRON_SECRET` is missing.
      _(new — `tests/e2e/cron-trigger.spec.ts`)_

Still deferred (needs a real or mocked blob endpoint):

- [ ] **P2** — Settings modal: re-validate a freshly typed token and see the 422 error for a rejected one (needs a fake blob store responding with known access levels).
- [ ] **P2** — Backup list filters actually hide rows once seeded data exists (host / db / media / source radio groups).
- [ ] **P2** — Backup item actions: download flow (redirect to signed URL) wired to the mocked blob — the delete path is now covered by the roundtrip spec above.
- [ ] **P3** — Visual-regression / snapshot coverage for the `BackupDashboard` inline CSS.

> Note: the in-memory dev app intentionally runs without a `BLOB_READ_WRITE_TOKEN`, so any
> test that exercises real blob I/O must set up a token either locally (via
> `dev/.env.local`) or via the optional `BLOB_READ_WRITE_TOKEN` secret in CI. Tests that
> need it `test.skip` themselves when the env is missing so the suite stays green in
> either configuration.

---

## P2 — medium (should have)

### Utilities (unit)

- [x] `createBlobName` / `transformBlobName` round-trip (new format, legacy format, labels, URL-reserved chars).
- [x] `getBackupSortTimeMs` prefers filename timestamp, falls back to uploadedAt, handles legacy seconds.
- [x] `sanitizeBackupLabel` (whitespace, length cap, hyphen runs).
- [x] `formatBytes` (B/KB/MB/GB formatting + invalid input).
- [x] `getCurrentDbName` / `getCurrentHostname` env parsing.
- [x] `maskBlobReadWriteToken` / `shouldPreserveBackupBlobTokenField` mask format + preservation heuristics.
- [x] `backupSelection` checkbox ↔ skip-list round-trip.
- [x] `restorePreview` — groups `pages`+`_pages_versions`, hides `backup-tasks`, flags `users`/`roles` as auth-session, admin sidebar ordering.
- [x] `vercelBackupCron` — `describeCronSchedule` produces a human string.
- [x] `backupSettings` helpers — `normalizeSkipMongoCollections`, `resolveBackupBlobToken`, `resolveBackupBlobAccess`, `resolveBackupArchiveRead`. _(new — `tests/unit/backupSettings.test.ts`)_

### Dashboard role access (unit)

- [x] `parseAllowedRolesEnv` parsing / empty segments.
- [x] `isUserAllowedByEnvRoles` — unauthenticated, `*`, backwards-compatible default, explicit allow-list.

### Settings endpoint — blob transfer (integration)

- [ ] **P2** — `PATCH /admin/settings` with `transferBackupBlobs: true` enqueues a `blobTransfer` task when there are existing blobs. _(deferred — the happy-path short-circuit is covered; the async enqueue can be a follow-up.)_

### Admin seed endpoint (integration)

- [ ] **P2** — `POST /admin/seed` is only registered when `seedDemoDumpUrl` is set, returns 503 without blob env, and otherwise queues `restoreSeedMedia` + `restoreBackup`. _(follow-up; coverage today is only that the endpoint is conditionally registered.)_

### Admin backup-download endpoint (integration)

- [ ] **P2** — `GET /admin/backup-download` requires auth, validates that `pathname` starts with `backups/`, refuses untrusted URLs, returns 404 when the blob isn't found, streams with the right `Content-Disposition`. _(follow-up)_

### End-to-end (Playwright)

See the E2E section under P1 for the Playwright items that moved to `covered` / `deferred`.

---

## P3 — less important (nice to have)

- [ ] **P3** — Unit tests for `dialogBackdrop` helper (Payload admin dialog focus trap escape key behaviour).
- [ ] **P3** — Property-based tests for `transformBlobName` with randomly generated labels / hostnames.
- [ ] **P3** — Coverage assertion in CI (threshold ~80%).
- [ ] **P3** — Visual regression / snapshot coverage for the `BackupDashboard` inline CSS (listed under E2E deferred).
- [ ] **P3** — E2E test that runs a full cron backup against a mocked blob server (listed under E2E deferred).

---

## Running the tests

```bash
# unit + integration (default)
pnpm test:int

# with coverage
pnpm test:int:cov

# end-to-end (starts dev server via playwright.config.ts)
pnpm test:e2e

# everything
pnpm test
```
