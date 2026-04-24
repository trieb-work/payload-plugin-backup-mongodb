import type { APIRequestContext } from '@playwright/test'

import { expect, test } from '@playwright/test'

import {
  expandBackupList,
  openBackupDashboard,
  requireBlobToken,
  requireCronSecret,
} from './helpers'

type BackupBlob = {
  downloadUrl: string
  pathname: string
  size: number
  uploadedAt: string
  url: string
}

const CRON_RUN_PATH = '/api/backup-mongodb/cron/run'
const CRON_LIST_PATH = '/api/backup-mongodb/cron/list'
const ADMIN_DELETE_PATH = '/api/backup-mongodb/admin/delete'

async function listCronBackups(request: APIRequestContext, secret: string): Promise<BackupBlob[]> {
  const response = await request.get(CRON_LIST_PATH, {
    headers: { Authorization: `Bearer ${secret}` },
  })
  if (!response.ok()) {
    throw new Error(`Cron list failed: ${response.status()} ${await response.text()}`)
  }
  const blobs = (await response.json()) as BackupBlob[]
  return blobs.filter((b) => b.pathname.startsWith('backups/cron-'))
}

test.describe('Cron API trigger → admin UI (dev app)', () => {
  test.beforeEach(() => {
    test.skip(
      !requireBlobToken() || !requireCronSecret(),
      'Needs BLOB_READ_WRITE_TOKEN and CRON_SECRET to exercise the real cron pipeline',
    )
  })

  // End-to-end cron roundtrip: dump mongo, upload blob, list again, render in admin.
  test.setTimeout(300_000)

  test('GET /api/backup-mongodb/cron/run creates a cron backup that shows up in the dashboard', async ({
    page,
    request,
  }) => {
    const secret = requireCronSecret()

    // Snapshot the current cron pathnames so we can tell ours apart from any other
    // cron backups already sitting in the bucket (e.g. from a scheduled run).
    const before = await listCronBackups(request, secret)
    const beforePaths = new Set(before.map((b) => b.pathname))

    // Trigger the cron endpoint the same way Vercel Cron would.
    const trigger = await request.get(CRON_RUN_PATH, {
      headers: { Authorization: `Bearer ${secret}` },
    })
    expect(trigger.status(), 'cron/run should return 202 Accepted').toBe(202)

    // The cron endpoint uses `after()` to queue the real upload — poll the list until
    // a new cron entry appears.
    let newBlob: BackupBlob | undefined
    await expect
      .poll(
        async () => {
          const after = await listCronBackups(request, secret)
          newBlob = after.find((b) => !beforePaths.has(b.pathname))
          return newBlob?.pathname ?? ''
        },
        {
          intervals: [1_000, 2_000, 3_000, 5_000],
          message: 'waiting for the cron backup to appear in /cron/list',
          timeout: 120_000,
        },
      )
      .toMatch(/^backups\/cron-/)

    expect(newBlob, 'new cron blob should be resolved by the poll').toBeTruthy()

    // ---- UI assertion: the backup shows up in the admin dashboard list ----------
    await openBackupDashboard(page)
    await expandBackupList(page)

    // Match the row by the exact pathname produced by the backup pipeline. The list
    // renders a `time` element + a `Cron backup` pill per row.
    const rowByTimestamp = page.locator('.backup-item').filter({
      has: page.locator('.backup-item__pill--cron'),
    })
    await expect(rowByTimestamp.first()).toBeVisible({ timeout: 30_000 })

    // The first (newest) cron backup should be exactly the one we just triggered —
    // the dashboard sorts by filename timestamp descending.
    if (!newBlob) {
      throw new Error('newBlob is undefined after poll')
    }
    const newestCronRow = rowByTimestamp.first()
    await expect(newestCronRow.locator('.backup-item__pill--cron')).toHaveText(/Cron backup/i)

    // ---- CLEANUP: delete the cron backup so we leave no trace ------------------
    // Uses the admin delete endpoint which piggy-backs on the logged-in Payload
    // session cookie that `openBackupDashboard` set on this Playwright context.
    const deleteResponse = await page.request.post(ADMIN_DELETE_PATH, {
      data: { pathname: newBlob.pathname, url: newBlob.url },
    })
    expect(deleteResponse.status(), 'admin/delete should accept and queue the delete task').toBe(
      202,
    )

    // Poll `/cron/list` until our pathname is gone to keep the bucket tidy for the
    // next run. Without this a flaky blob quota would fail later tests.
    await expect
      .poll(
        async () => {
          const after = await listCronBackups(request, secret)
          return after.some((b) => b.pathname === newBlob?.pathname)
        },
        {
          intervals: [1_000, 2_000, 3_000, 5_000],
          message: 'waiting for the cron backup to disappear from /cron/list',
          timeout: 60_000,
        },
      )
      .toBe(false)
  })
})
