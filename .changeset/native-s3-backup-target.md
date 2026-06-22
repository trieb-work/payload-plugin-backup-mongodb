---
'@trieb.work/payload-plugin-backup-mongodb': minor
---

Add native AWS S3 as a selectable backup target alongside Vercel Blob.

Set `BACKUP_STORAGE=s3` and configure `BACKUP_S3_*` env vars to store backups in
S3 — or any S3-compatible store (Cloudflare R2, MinIO) via `BACKUP_S3_ENDPOINT`.
Vercel Blob remains the default, so existing deployments are unaffected. The AWS
SDK is an optional peer dependency, loaded only when the S3 target is used.
