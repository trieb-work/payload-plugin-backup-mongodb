import { randomBytes, timingSafeEqual } from 'node:crypto'

import type { Payload } from 'payload'

export type BackupTaskKind = 'backup' | 'restore' | 'seed' | 'delete' | 'blobTransfer'
export type BackupTaskStatus = 'queued' | 'running' | 'completed' | 'failed'

export type BackupTaskProgress = {
  createdAt: string
  error?: string | null
  id: string
  kind: BackupTaskKind
  message: string
  status: BackupTaskStatus
  updatedAt: string
}

/** Task row as stored / returned from Payload (includes server-only poll secret). */
export type BackupTaskWithPollSecret = BackupTaskProgress & {
  pollSecret?: string | null
}

export function pollSecretsMatch(provided: string, stored: string | null | undefined): boolean {
  if (!stored || !provided) return false
  const a = Buffer.from(provided, 'utf8')
  const b = Buffer.from(stored, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function stripPollSecretForClient(task: BackupTaskWithPollSecret): BackupTaskProgress {
  const { pollSecret: _pollSecret, ...rest } = task
  return rest as BackupTaskProgress
}

export async function createBackupTask(
  payload: Payload,
  kind: BackupTaskKind,
  message: string,
): Promise<{ pollSecret: string; taskId: string }> {
  const pollSecret = randomBytes(32).toString('hex')
  const doc = await payload.create({
    collection: 'backup-tasks',
    data: { kind, message, pollSecret, status: 'queued' },
    overrideAccess: true,
  })
  return { pollSecret, taskId: doc.id as string }
}

export async function getBackupTask(
  payload: Payload,
  id: string,
): Promise<BackupTaskWithPollSecret | undefined> {
  try {
    const doc = await payload.findByID({
      collection: 'backup-tasks',
      id,
      overrideAccess: true,
    })
    return doc as unknown as BackupTaskWithPollSecret
  } catch {
    return undefined
  }
}

export async function updateBackupTask(
  payload: Payload,
  id: string,
  patch: Partial<Pick<BackupTaskProgress, 'error' | 'message' | 'status'>>,
): Promise<BackupTaskProgress | undefined> {
  try {
    const doc = await payload.update({
      collection: 'backup-tasks',
      id,
      data: patch,
      overrideAccess: true,
    })
    return doc as unknown as BackupTaskProgress
  } catch {
    return undefined
  }
}

export async function completeBackupTask(
  payload: Payload,
  id: string,
  message: string,
): Promise<BackupTaskProgress | undefined> {
  return updateBackupTask(payload, id, { message, status: 'completed' })
}

export async function failBackupTask(
  payload: Payload,
  id: string,
  error: unknown,
): Promise<BackupTaskProgress | undefined> {
  return updateBackupTask(payload, id, {
    error: error instanceof Error ? error.message : String(error),
    message: 'Task failed',
    status: 'failed',
  })
}
