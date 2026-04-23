# @trieb.work/payload-plugin-backup-mongodb

A **Payload CMS v3** plugin for MongoDB + media backup, restore, and scheduled retention — with zero
meta-database and a built-in admin UI. Backups live directly in Vercel Blob Storage, so a fresh
install can list and restore any prior backup without bootstrapping a database first.

> Status: experimental. Developed inside the [payblocks](https://github.com/) website template and
> spun out as a standalone plugin. Feedback and PRs welcome.

![Backup dashboard embedded in the Payload admin panel](./docs/screenshots/dashboard.png)

A first-class **Backups** section lives right below the Payload dashboard: browse every archive
sorted by creation time, see at a glance which host and database it belongs to, whether media is
bundled and how big it is, then download, restore or delete any backup with one click.

---

## Highlights

- **No meta database.** Every backup is self-describing in its blob name (`type---db---host---{collectionCount}-{timestampMs}.{ext}`). A brand new project can list and restore any backup straight from blob storage.
- **Scheduled (cron) and on-demand backups.** Wire `/api/backup-mongodb/cron/run` to Vercel Cron or any HTTP scheduler. Retention is configurable (N most recent cron backups are kept; older ones are pruned automatically).
- **Full database coverage.** Dumps **every** MongoDB collection via the Payload mongoose adapter — including hidden system collections like `users`, `payload-preferences`, `payload-migrations`. Individual collections can be excluded per-backup from the UI or via API.
- **Optional media bundling.** Cron or manual backups can include Payload `media` blobs in a `.tar.gz` archive alongside the MongoDB dump.
- **Restore with filters.** Restore any backup with an optional collection blacklist and `mergeData` upsert mode. Partial restores keep the running admin session / tasks collection intact.
- **Native admin dashboard.** Adds a `BackupDashboard` widget to the Payload admin (via `afterDashboard`): list / sort / filter / search backups, trigger manual backups or restores, configure retention and storage, and live-poll long-running tasks.
- **Payload REST, not Next.js route files.** All endpoints are registered as Payload custom endpoints and served by the default `/api/[...slug]` handler — you don't need to create any `app/.../route.ts` files yourself.
- **Pluggable blob storage.** Uses `BLOB_READ_WRITE_TOKEN` by default (the same store you already use for `@payloadcms/storage-vercel-blob`), or point backups at a dedicated Vercel Blob store via the settings UI. Both **public** and **private** access stores are supported; a validation probe detects which modes the store accepts.
- **Safe, resumable long-running tasks.** Manual backups, restores and seed runs are executed via `next/server`'s `after()` and tracked in a hidden `backup-tasks` collection with TTL (30 min). Clients poll progress with a signed short-lived `pollSecret`, so task status is visible even to unauthenticated follow-up requests during the same action.
- **Demo/seed support.** Optional `seedDemoDumpUrl` option registers a one-click seed endpoint for templates/starters.
- **Tested.** Unit tests (Vitest) cover archive, backup, restore, task progress, blob I/O, endpoint auth, cron parsing and blob-name helpers.

---

## Requirements

- Payload CMS **v3+** with the `@payloadcms/db-mongodb` adapter (uses `payload.db.connection.db` internally).
- MongoDB (any version supported by Payload).
- A Vercel Blob Storage token (`BLOB_READ_WRITE_TOKEN`). Vercel hosting is **not** required — any Node runtime that can reach Vercel Blob works.
- Next.js **15+** and React **19+** (required by Payload 3).

### Environment variables

| Variable                 | Required | Purpose                                                                                               |
| ------------------------ | -------- | ----------------------------------------------------------------------------------------------------- |
| `MONGODB_URI`            | yes      | MongoDB connection string (used by Payload and by the plugin to label backups with the DB name).      |
| `BLOB_READ_WRITE_TOKEN`  | yes      | Default Vercel Blob store for backups and media. Can be overridden per-project in the admin settings. |
| `CRON_SECRET`            | for cron | Bearer token required on every `/api/backup-mongodb/cron/*` call. Vercel Cron sets this for you.      |
| `NEXT_PUBLIC_SERVER_URL` | optional | Used to label backups with the current host. Falls back to `VERCEL_URL`.                              |
| `BACKUPS_TO_KEEP`        | optional | Default retention for cron backups if the settings doc hasn't been edited. Default `10`.              |

---

## Installation

### 1. Add the package

```bash
pnpm add @trieb.work/payload-plugin-backup-mongodb
# or: npm install @trieb.work/payload-plugin-backup-mongodb
# or: yarn add @trieb.work/payload-plugin-backup-mongodb
```

The package also has peer deps on `payload`, `@payloadcms/ui`, `@vercel/blob`, `bson`, `tar-stream`, `next` and `react`; all are satisfied by any Payload 3 + Next.js 15 app.

### 2. Tell Next.js to transpile the package

The plugin ships TypeScript sources so it can be consumed everywhere Payload runs without extra build steps. Add it to `transpilePackages` in `next.config.ts`:

```ts
// next.config.ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: ['@trieb.work/payload-plugin-backup-mongodb'],
}

export default nextConfig
```

### 3. Register the plugin in `payload.config.ts`

Starting with v0.1.0, the plugin ships a pre-built ESM bundle (`dist/index.js`) that is safe to
import directly from `payload.config.ts` — even when the Payload CLI evaluates the file through
[`jiti`](https://github.com/unjs/jiti). No local wrapper file is needed:

```ts
// src/payload.config.ts
import { buildConfig } from 'payload'
import { backupMongodbPlugin } from '@trieb.work/payload-plugin-backup-mongodb'

export default buildConfig({
  // …your collections, globals, etc.
  plugins: [
    backupMongodbPlugin({
      // All options are optional. See "Plugin options" below.
      enabled: !!(process.env.MONGODB_URI && process.env.BLOB_READ_WRITE_TOKEN),
      backupsToKeep: 10,
    }),
  ],
})
```

The plugin automatically:

- registers the hidden `backup-settings` (singleton) and `backup-tasks` (TTL-indexed) collections,
- mounts `BackupDashboard` after the admin dashboard,
- registers all `/api/backup-mongodb/*` endpoints.

### 4. Regenerate types and import map

```bash
pnpm payload generate:types
pnpm payload generate:importmap
```

### 5. Wire up the cron endpoint (optional but recommended)

Create or extend `vercel.json` in the project root. The path must be `/api/backup-mongodb/cron/run` (or whatever `routes.api` prefix your Payload config uses), and the schedule is a standard cron expression — use [crontab.guru](https://crontab.guru/) if you want a visual builder.

```json
{
  "crons": [
    {
      "path": "/api/backup-mongodb/cron/run",
      "schedule": "0 3 * * *"
    }
  ]
}
```

Vercel Cron injects the `Authorization: Bearer $CRON_SECRET` header automatically. For non-Vercel environments (any Node host, k8s CronJob, GitHub Actions, …) simply hit the same URL with `Authorization: Bearer <your CRON_SECRET>`.

---

## Admin UI

After the first login as an admin user, a **Backups** section appears below the default Payload
dashboard. It's fully self-contained: no extra routes to register, no separate app to run.
Every day-to-day task — creating, downloading, restoring, deleting, scheduling — happens in the
dialogs shown below. Access defaults to users whose `roles` array contains a role with slug
`admin`; override it via the `access` option (see [Plugin options](#plugin-options)).

### Scheduled (cron) vs on-demand (manual) backups

The plugin supports both modes side by side, each optimized for a different use case:

- **Scheduled / cron backups** run on a cron expression (typically via `vercel.json`) and use the
  shared settings documented below: fixed retention, a fixed media toggle, and a fixed list of
  collections to skip. Old cron archives are pruned automatically once the keep-count is exceeded.
  They show up in the list labeled `CRON BACKUP`.
- **Manual / on-demand backups** are triggered from the dashboard and configured **per backup**:

![Manual backup dialog with per-collection selection and optional media bundling](./docs/screenshots/manual-backup.png)

Each collection can be toggled on/off individually (including hidden system collections like
`users`, `payload-preferences`, `payload-migrations`). Document counts are shown up front so you
know exactly how much data will be included. If your project has a `media` collection, a dedicated
checkbox lets you bundle the actual image/file blobs from storage into the archive (`.tar.gz`)
instead of just the Mongo metadata. Manual runs ignore the cron retention policy and are never
auto-pruned, so you can use them as safe "checkpoints" before risky migrations.

### Selective restore with per-collection preview

Restoring doesn't have to be all-or-nothing. Clicking **Restore** on any backup opens a preview of
the archive's contents before anything is written to the database:

![Restore dialog previewing document counts per collection, including versions](./docs/screenshots/restore.png)

The preview lists every collection inside the archive with its document count (and version-history
count where applicable), so you can:

- **Restore everything** by leaving "Restore all collections" checked, or
- **Cherry-pick** individual collections — e.g. roll back only `pages` after a botched release
  while keeping current `users`, `orders`, or `form-submissions` untouched, or
- **Opt out of media** uploads from `.tar.gz` archives when you just need the database rows back.

Restoring a backup from a _different_ host or database also works: the dashboard filter hides
foreign-host archives by default but you can show them explicitly, which is handy for cloning
production data into staging or seeding a local dev DB.

### Scheduled backup settings

Cron retention, storage token, and the cron-mode collection skip-list all live in one modal:

![Scheduled backup settings: cron schedule, retention, dedicated blob token, collection skip list](./docs/screenshots/settings.png)

From top to bottom:

- **Schedule**: read-only summary of the active cron job. The plugin parses `vercel.json` and
  renders a human-readable description of the cron expression (via
  [`cronstrue`](https://github.com/bradymholt/cronstrue)) so you always know when the next run is.
- **Retention**: how many cron archives to keep; older cron runs are deleted after each successful
  backup. Manual backups are **not** affected by this setting.
- **Dedicated backup storage** _(optional)_: paste a separate Vercel Blob read/write token if you
  want backups to live in a different store than your media (for example, a private customer-
  managed store). A validation probe tests the token, detects whether the store supports public
  or private access, and offers to transfer existing archives from the old store into the new one
  before switching. The token field is masked once saved.
- **Collection selection**: which collections cron backups should include. Defaults to
  "everything", with individual opt-outs per collection. Manual backups ask again every time.

---

## Plugin options

```ts
type BackupPluginOptions = {
  /** Disable the plugin entirely (no collections, no endpoints, no UI). Default: true. */
  enabled?: boolean

  /** Default number of cron backups to keep when no setting is saved. Default: env BACKUPS_TO_KEEP or 10. */
  backupsToKeep?: number

  /**
   * Register `POST /api/backup-mongodb/admin/seed` (demo DB dump + public/seed/media seed).
   * Useful for template/starter repos. Omit to disable.
   */
  seedDemoDumpUrl?: string

  /**
   * Custom access check for all admin routes and the dashboard component.
   * Receives Payload's user object and must return true to allow access.
   * Default: user must have a role with slug `admin`.
   */
  access?: (user: Record<string, unknown> | null) => boolean
}
```

Example with a custom access function and seed URL (typical starter setup):

```ts
backupMongodbPlugin({
  access: (user) =>
    Array.isArray((user as any)?.roles) &&
    (user as any).roles.some((r: any) => r?.slug === 'admin' || r?.slug === 'superadmin'),
  seedDemoDumpUrl: 'https://example.com/seed/demo-db.json',
})
```

---

## HTTP API (Payload REST)

All endpoints are served by Payload's default `/api/[...slug]` handler under
**`/api/backup-mongodb/…`** (the `backup-mongodb` prefix avoids clashing with a collection whose
slug is `backup`). The admin UI uses the same URLs via the exported `backupPluginPublicApiPaths`
helper.

### Cron / external (Bearer `CRON_SECRET`)

```http
GET  /api/backup-mongodb/cron/run        # enqueue a cron backup
GET  /api/backup-mongodb/cron/list       # list backups
POST /api/backup-mongodb/cron/restore    # body: { "url": "https://…" }
Authorization: Bearer <CRON_SECRET>
```

### Admin (Payload session cookie, or task `pollSecret` for `/task/:id`)

| Method         | Path                                                                |
| -------------- | ------------------------------------------------------------------- |
| `POST`         | `/api/backup-mongodb/admin/manual`                                  |
| `POST`         | `/api/backup-mongodb/admin/restore`                                 |
| `POST`         | `/api/backup-mongodb/admin/backup-preview`                          |
| `POST`         | `/api/backup-mongodb/admin/restore-preview`                         |
| `POST`         | `/api/backup-mongodb/admin/delete`                                  |
| `GET`          | `/api/backup-mongodb/admin/backup-download`                         |
| `GET`          | `/api/backup-mongodb/admin/task/:id`                                |
| `GET` / `POST` | `/api/backup-mongodb/admin/settings`                                |
| `POST`         | `/api/backup-mongodb/admin/validate-blob-token`                     |
| `POST`         | `/api/backup-mongodb/admin/seed` — only if `seedDemoDumpUrl` is set |

---

## Programmatic API

For scripts, custom hooks or tests:

```ts
import {
  createBackup,
  listBackups,
  restoreBackup,
  restoreSeedMedia,
  createMediaBackupFile,
  getDb,
  createTarGzip,
  resolveTarGzip,
  createBlobName,
  transformBlobName,
  getBackupSortTimeMs,
  formatBytes,
  getCurrentDbName,
  getCurrentHostname,
  backupPluginPublicApiPaths,
} from '@trieb.work/payload-plugin-backup-mongodb'

// Trigger a manual backup from a Payload task / migration / one-off script:
await createBackup(payload, { cron: false, includeMedia: true })

// Restore from a URL, skipping the `users` collection:
await restoreBackup(payload, downloadUrl, ['users'], /* mergeData */ false)

// List existing backups (respects the token you pass; falls back to env):
const blobs = await listBackups(process.env.BLOB_READ_WRITE_TOKEN)
```

The default export barrel only contains server-safe helpers. Client components (`TaskActionButton`, `BackupListCollapsible`, dialogs, …) are reachable via the `/client` sub-path:

```ts
import { TaskActionButton } from '@trieb.work/payload-plugin-backup-mongodb/client'
```

---

## Blob storage model

### Blob naming

```
backups/{type}---{dbName}---{hostname}---{collectionCount}-{timestampMs}.{json|tar.gz}
```

- `type`: `cron` or `manual` (also `cron-` for legacy listings).
- `dbName` / `hostname`: URL-encoded; pulled from `MONGODB_URI` and `NEXT_PUBLIC_SERVER_URL` / `VERCEL_URL`.
- `collectionCount-timestampMs`: embedded sort key used by the UI (falls back to blob `uploadedAt` for legacy names).

### Public vs private stores

`validateBackupBlobToken` probes an unused path in the target store, first as `private`, then `public`. The detected access level is persisted in `backup-settings.backupBlobAccess` and used when uploading new archives. Private blobs are fetched via `get(pathname, { access: 'private', token })`; public blobs use anonymous `downloadUrl` with a signed-SDK fallback. Restore/preview endpoints transparently handle both.

### Overriding the backup store

If you want backups to live in a different Vercel Blob store than your media (e.g. a private customer-managed store), open the **Backup settings** modal in the admin, paste a dedicated `BLOB_READ_WRITE_TOKEN`, validate it and — optionally — transfer existing backups from the old store into the new one before switching.

---

## Running the tests

```bash
pnpm test:int
```

To iterate on the plugin inside a full Payload instance (Next.js admin panel, MongoDB memory
server), use the bundled `dev/` project:

```bash
pnpm install
pnpm dev        # http://localhost:3000/admin  (login: dev@payloadcms.com / test)
```

All external services (`@vercel/blob`, `bson`) are mocked with `vi.mock()`. Tests target `src/core`, `src/utils`, `src/endpoints` and `src/components` helpers.

---

## Roadmap / ideas

- Test and optimize for very large backups. Vercel Blob supports up to 5 TB per object via multipart uploads (5 GB single-part); we may need to switch to `putMultipart` at some threshold.
- Additional storage adapters: S3, Azure, GCP, Cloudflare R2, filesystem.
- Scheduler-agnostic cron helpers (currently reads `vercel.json` to render the schedule in the admin UI).
- Progressive streaming restore to avoid holding the whole archive in memory for big databases.
- add E2E tests with an demo payload project
- make backup folder configurable

---

## License

MIT
