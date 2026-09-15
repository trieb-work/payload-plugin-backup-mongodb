/**
 * Creates the CI MinIO bucket before integration / E2E tests. No-op when S3 env is absent.
 */
import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3'

const bucket = process.env.BACKUP_S3_BUCKET?.trim()
const endpoint = process.env.BACKUP_S3_ENDPOINT?.trim()

if (!bucket || !endpoint) {
  console.log('ci-minio-setup: BACKUP_S3_BUCKET or BACKUP_S3_ENDPOINT not set — skipping')
  process.exit(0)
}

const accessKeyId =
  process.env.BACKUP_S3_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID ?? 'minioadmin'
const secretAccessKey =
  process.env.BACKUP_S3_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY ?? 'minioadmin'
const region = process.env.BACKUP_S3_REGION ?? process.env.AWS_REGION ?? 'us-east-1'
const forcePathStyle = process.env.BACKUP_S3_FORCE_PATH_STYLE !== 'false'

const client = new S3Client({
  credentials: { accessKeyId, secretAccessKey },
  endpoint,
  forcePathStyle,
  region,
})

try {
  await client.send(new HeadBucketCommand({ Bucket: bucket }))
  console.log(`ci-minio-setup: bucket "${bucket}" already exists`)
} catch {
  await client.send(new CreateBucketCommand({ Bucket: bucket }))
  console.log(`ci-minio-setup: created bucket "${bucket}"`)
}
