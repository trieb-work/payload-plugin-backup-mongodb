import type { Endpoint } from 'payload'

import { list } from '@vercel/blob'
import { after } from 'next/server'

import type { BackupPluginOptions } from '../../types'

import { transferBackupBlobsToToken } from '../../core/backupBlobTransfer'
import {
  BACKUP_SETTINGS_SLUG,
  getResolvedCronBackupSettings,
  normalizeSkipMongoCollections,
  resolveBackupBlobAccess,
  resolveBackupBlobToken,
  toPayloadSkipRows,
} from '../../core/backupSettings'
import { validateBackupBlobToken } from '../../core/blobTokenValidate'
import {
  completeBackupTask,
  createBackupTask,
  failBackupTask,
  updateBackupTask,
} from '../../core/taskProgress'
import { describeCronSchedule, readVercelBackupCronFromRepo } from '../../core/vercelBackupCron'
import {
  maskBlobReadWriteToken,
  shouldPreserveBackupBlobTokenField,
} from '../../utils/maskBlobToken'
import { readRequestJson, requireBackupAdmin } from '../shared'

function clampBackupsToKeep(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    return 10
  }
  return Math.min(365, Math.max(1, Math.floor(n)))
}

function buildSettingsJson(
  stored: Awaited<ReturnType<typeof getResolvedCronBackupSettings>>,
  options: BackupPluginOptions,
  vercelCron: ReturnType<typeof readVercelBackupCronFromRepo>,
  humanDescription: null | string,
  transfer:
    | {
        deferred: boolean
        failed: number
        performed: boolean
        pollSecret?: string
        skipped: number
        taskId?: string
        total: number
        transferred: number
      }
    | undefined,
) {
  const t = transfer ?? {
    deferred: false,
    failed: 0,
    performed: false,
    skipped: 0,
    total: 0,
    transferred: 0,
  }
  return {
    id: stored.id,
    backupBlobAccess: stored.backupBlobAccess,
    backupBlobAccessEffective: resolveBackupBlobAccess(stored),
    backupBlobTokenMasked: maskBlobReadWriteToken(stored.backupBlobReadWriteToken),
    backupsToKeep: stored.backupsToKeep,
    cron: vercelCron
      ? {
          configFileRelative: vercelCron.configFileRelative,
          humanDescription,
          path: vercelCron.path,
          schedule: vercelCron.schedule,
        }
      : null,
    effectiveBackupsToKeep:
      typeof options.backupsToKeep === 'number' ? options.backupsToKeep : stored.backupsToKeep,
    hasBackupBlobReadWriteToken: stored.backupBlobReadWriteToken.trim().length > 0,
    includeMediaForCron: stored.includeMediaForCron,
    pluginBackupsToKeepOverride: typeof options.backupsToKeep === 'number',
    skipMongoCollections: stored.skipMongoCollections,
    transfer: t,
  }
}

export function createAdminSettingsEndpoints(options: BackupPluginOptions): Endpoint[] {
  return [
    {
      handler: async (req) => {
        const auth = await requireBackupAdmin(req, options)
        if (auth instanceof Response) {
          return auth
        }

        const { payload } = req
        const stored = await getResolvedCronBackupSettings(payload)
        const vercelCron = readVercelBackupCronFromRepo()
        const humanDescription =
          vercelCron?.schedule != null ? describeCronSchedule(vercelCron.schedule) : null

        return Response.json(
          buildSettingsJson(stored, options, vercelCron, humanDescription, undefined),
        )
      },
      method: 'get',
      path: '/backup-mongodb/admin/settings',
    },
    {
      handler: async (req) => {
        const auth = await requireBackupAdmin(req, options)
        if (auth instanceof Response) {
          return auth
        }

        const { payload } = req
        const body = (await readRequestJson(req)) as Record<string, unknown>
        const backupsToKeep = clampBackupsToKeep(body?.backupsToKeep)
        const skipMongoCollections = normalizeSkipMongoCollections(body?.skipMongoCollections)
        const includeMediaForCron = body?.includeMediaForCron === true
        const transferBackupBlobs =
          typeof body?.transferBackupBlobs === 'boolean' ? body.transferBackupBlobs : false
        const deleteBackupBlobsFromSource =
          typeof body?.deleteBackupBlobsFromSource === 'boolean'
            ? body.deleteBackupBlobsFromSource
            : false
        const requestedRaw =
          typeof body?.backupBlobReadWriteToken === 'string' ? body.backupBlobReadWriteToken : ''
        const requestedTrimmed = requestedRaw.trim()

        let stored = await getResolvedCronBackupSettings(payload)
        const previousAccess = resolveBackupBlobAccess(stored)
        const previousBackupBlobToken = stored.backupBlobReadWriteToken.trim()
        const hadStoredToken = previousBackupBlobToken.length > 0
        const preserveTokenField = shouldPreserveBackupBlobTokenField(
          requestedTrimmed,
          hadStoredToken,
        )
        const tokenForDb = preserveTokenField ? previousBackupBlobToken : requestedTrimmed

        // Access detection: re-probe when the token actually changes; preserve existing otherwise;
        // clear when the override is removed (falls back to heuristic on the default env token).
        let backupBlobAccessForDb: 'private' | 'public' | null = stored.backupBlobAccess
        if (!preserveTokenField) {
          if (tokenForDb.length === 0) {
            backupBlobAccessForDb = null
          } else {
            const validation = await validateBackupBlobToken(tokenForDb)
            if (!validation.ok) {
              return Response.json(
                { error: `Blob token rejected: ${validation.error ?? 'unknown error'}` },
                { status: 422 },
              )
            }
            backupBlobAccessForDb = validation.access ?? null
          }
        }

        if (!stored.id) {
          await payload.create({
            collection: BACKUP_SETTINGS_SLUG,
            data: {
              backupBlobAccess: backupBlobAccessForDb,
              backupBlobReadWriteToken: tokenForDb,
              backupsToKeep,
              includeMediaForCron,
              skipMongoCollections: toPayloadSkipRows(skipMongoCollections),
            },
            overrideAccess: true,
          })
        } else {
          await payload.update({
            id: stored.id,
            collection: BACKUP_SETTINGS_SLUG,
            data: {
              backupBlobAccess: backupBlobAccessForDb,
              backupBlobReadWriteToken: tokenForDb,
              backupsToKeep,
              includeMediaForCron,
              skipMongoCollections: toPayloadSkipRows(skipMongoCollections),
            },
            overrideAccess: true,
          })
        }

        stored = await getResolvedCronBackupSettings(payload)
        if (!stored.id) {
          return Response.json({ error: 'Could not persist backup settings' }, { status: 500 })
        }

        const vercelCron = readVercelBackupCronFromRepo()
        const humanDescription =
          vercelCron?.schedule != null ? describeCronSchedule(vercelCron.schedule) : null

        const newBlobToken = stored.backupBlobReadWriteToken.trim()
        // Read blobs from the *previous* store when rotating tokens; otherwise first-time setup
        // reads from BLOB_READ_WRITE_TOKEN (default Vercel store).
        const sourceTokenForTransfer =
          previousBackupBlobToken.length > 0
            ? previousBackupBlobToken
            : (process.env.BLOB_READ_WRITE_TOKEN || '').trim()

        const shouldTransferToNewBlobToken =
          newBlobToken.length > 0 &&
          sourceTokenForTransfer.length > 0 &&
          newBlobToken !== sourceTokenForTransfer

        if (!transferBackupBlobs || !shouldTransferToNewBlobToken) {
          return Response.json(
            buildSettingsJson(stored, options, vercelCron, humanDescription, {
              deferred: false,
              failed: 0,
              performed: false,
              skipped: 0,
              total: 0,
              transferred: 0,
            }),
          )
        }

        const targetToken = resolveBackupBlobToken(stored)
        const targetAccess = resolveBackupBlobAccess(stored)
        const { blobs } = await list({
          limit: 1000,
          prefix: 'backups/',
          token: sourceTokenForTransfer,
        })
        const total = blobs.length

        if (total === 0) {
          const summary = await transferBackupBlobsToToken(
            payload,
            sourceTokenForTransfer,
            targetToken,
            {
              deleteFromSource: deleteBackupBlobsFromSource,
              sourceAccessHint: previousAccess,
              targetAccess,
            },
          )
          return Response.json(
            buildSettingsJson(stored, options, vercelCron, humanDescription, {
              deferred: false,
              failed: summary.failed,
              performed: true,
              skipped: summary.skipped,
              total: summary.total,
              transferred: summary.transferred,
            }),
          )
        }

        const { pollSecret, taskId } = await createBackupTask(
          payload,
          'blobTransfer',
          JSON.stringify({ failed: 0, pathname: '', total, transferred: 0 }),
        )

        after(
          (async () => {
            try {
              await updateBackupTask(payload, taskId, {
                message: JSON.stringify({ failed: 0, pathname: '', total, transferred: 0 }),
                status: 'running',
              })
              const summary = await transferBackupBlobsToToken(
                payload,
                sourceTokenForTransfer,
                targetToken,
                {
                  deleteFromSource: deleteBackupBlobsFromSource,
                  sourceAccessHint: previousAccess,
                  targetAccess,
                  taskId,
                },
              )
              await completeBackupTask(
                payload,
                taskId,
                JSON.stringify({
                  failed: summary.failed,
                  pathname: '',
                  phase: 'done',
                  total: summary.total,
                  transferred: summary.transferred,
                }),
              )
            } catch (e) {
              await failBackupTask(payload, taskId, e)
              payload.logger.error(
                { err: e, taskId },
                '[backup-settings] Blob transfer task failed',
              )
            }
          })(),
        )

        return Response.json(
          buildSettingsJson(stored, options, vercelCron, humanDescription, {
            deferred: true,
            failed: 0,
            performed: true,
            pollSecret,
            skipped: 0,
            taskId,
            total,
            transferred: 0,
          }),
        )
      },
      method: 'patch',
      path: '/backup-mongodb/admin/settings',
    },
  ]
}
