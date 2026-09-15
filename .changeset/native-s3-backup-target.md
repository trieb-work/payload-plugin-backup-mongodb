---
'@trieb.work/payload-plugin-backup-mongodb': minor
---

Add native AWS S3 as a selectable backup target alongside Vercel Blob.

Set `BACKUP_STORAGE=s3` and configure `BACKUP_S3_*` env vars to store backups in
S3 — or any S3-compatible store (Cloudflare R2, MinIO) via `BACKUP_S3_ENDPOINT`.
Vercel Blob remains the default for backup archives, so existing deployments are
unaffected unless they opt in. The AWS SDK is an optional peer dependency (Node
20+), loaded only when the S3 target is used.

**Breaking changes (intentional):**

- Removed the demo seed API (`seedDemoDumpUrl`, `/admin/seed`,
  `restoreSeedMedia` export). A backup plugin should not ship generous public
  seed endpoints.
- Dropped Node 18 support; the package now requires Node 20.9+ (aligned with the
  AWS SDK versions resolved for the S3 target).
