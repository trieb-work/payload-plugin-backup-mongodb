'use client'

import { Button, Pill } from '@payloadcms/ui'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { BackupTaskProgress } from '../../core/taskProgress.js'
import { backupPluginPublicApiPaths } from '../../publicApiPaths.js'
import { closeNativeDialogOnBackdropPointer } from '../../utils/dialogBackdrop.js'

export interface TaskActionDangerConfirm {
  body: string
  cancelLabel?: string
  confirmLabel?: string
  title: string
  /** If true, show a second confirmation dialog before running the request (e.g. lock-out risk). */
  when: () => boolean
}

type TaskActionButtonProps = {
  body?: Record<string, unknown>
  buttonStyle?: 'error' | 'primary' | 'secondary' | 'subtle'
  className?: string
  completeLabel?: string
  /** Extra confirmation dialog (danger) before POST — runs when `when()` returns true on click. */
  dangerConfirm?: TaskActionDangerConfirm
  endpoint: string
  /** When true, the idle (not-yet-running) action is disabled — e.g. while a restore preview loads. */
  idleDisabled?: boolean
  idleLabel: string
  kind: BackupTaskProgress['kind']
  /** Invoked once when the task reaches `completed` (after optional `refreshOnComplete`). Not called when `redirectOnComplete` is set. */
  onComplete?: () => void
  pendingLabel: string
  redirectOnComplete?: string
  refreshOnComplete?: boolean
}

export const TaskActionButton: React.FC<TaskActionButtonProps> = ({
  body,
  buttonStyle = 'primary',
  className,
  completeLabel,
  dangerConfirm,
  endpoint,
  idleDisabled = false,
  idleLabel,
  kind,
  onComplete,
  pendingLabel,
  redirectOnComplete,
  refreshOnComplete = false,
}) => {
  const router = useRouter()
  const dangerDialogRef = useRef<HTMLDialogElement>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  /** Avoid firing `onComplete` twice if the polling effect re-runs while status stays `completed`. */
  const completeNotifyForTaskIdRef = useRef<string | null>(null)
  /** Lets the task GET succeed after restore replaces `users` (session becomes invalid). */
  const pollSecretRef = useRef<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isStarting, setIsStarting] = useState(false)
  const [task, setTask] = useState<BackupTaskProgress | null>(null)

  const isBusy = isStarting || task?.status === 'queued' || task?.status === 'running'
  const message = error || task?.error || task?.message || ''

  const label = useMemo(() => {
    if (isBusy) {
      return pendingLabel
    }

    if (task?.status === 'completed' && completeLabel) {
      return completeLabel
    }

    return idleLabel
  }, [completeLabel, idleLabel, isBusy, pendingLabel, task?.status])

  const pillStyle = useMemo(() => {
    if (error || task?.status === 'failed') {
      return 'error' as const
    }

    if (task?.status === 'completed') {
      return 'success' as const
    }

    if (isBusy || task?.status === 'queued' || task?.status === 'running') {
      return 'warning' as const
    }

    return 'light-gray' as const
  }, [error, isBusy, task?.status])

  const statusLabel = useMemo(() => {
    if (error || task?.status === 'failed') {
      return 'Failed'
    }

    if (task?.status === 'completed') {
      return 'Done'
    }

    if (isBusy || task?.status === 'queued' || task?.status === 'running') {
      return 'Working'
    }

    return 'Idle'
  }, [error, isBusy, task?.status])

  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!task?.id || task.status === 'completed' || task.status === 'failed') {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }

      if (task?.status === 'completed') {
        if (redirectOnComplete) {
          window.location.assign(redirectOnComplete)
          return
        }

        if (completeNotifyForTaskIdRef.current !== task.id) {
          completeNotifyForTaskIdRef.current = task.id
          if (refreshOnComplete) {
            router.refresh()
          }
          onComplete?.()
        }
      }

      return
    }

    intervalRef.current = setInterval(async () => {
      const response = await fetch(backupPluginPublicApiPaths.adminTask(task.id), {
        cache: 'no-store',
        ...(pollSecretRef.current
          ? { headers: { Authorization: `Bearer ${pollSecretRef.current}` } }
          : {}),
      })

      if (!response.ok) {
        clearInterval(intervalRef.current!)
        intervalRef.current = null
        setError('Could not load task progress')
        return
      }

      const nextTask = (await response.json()) as BackupTaskProgress
      setTask(nextTask)
    }, 1000)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [onComplete, redirectOnComplete, refreshOnComplete, router, task?.id, task?.status])

  const runTask = async () => {
    try {
      setError(null)
      setIsStarting(true)
      pollSecretRef.current = null
      completeNotifyForTaskIdRef.current = null
      setTask(null)

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body ?? {}),
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(text || 'Request failed')
      }

      const data = (await response.json()) as { pollSecret?: string; taskId: string }
      pollSecretRef.current = data.pollSecret ?? null
      const now = new Date().toISOString()
      setTask({
        createdAt: now,
        id: data.taskId,
        kind,
        message: 'Task queued',
        status: 'queued',
        updatedAt: now,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setIsStarting(false)
    }
  }

  const handlePrimaryClick = async () => {
    if (dangerConfirm?.when()) {
      dangerDialogRef.current?.showModal()
      return
    }
    await runTask()
  }

  const handleDangerConfirm = async () => {
    dangerDialogRef.current?.close()
    await runTask()
  }

  return (
    <>
      <div className="backup-task-action">
        <Button
          buttonStyle={buttonStyle}
          className={className}
          disabled={isBusy || idleDisabled}
          size="medium"
          onClick={() => void handlePrimaryClick()}
        >
          {label}
        </Button>

        {(task !== null || error !== null) && (
          <div className="backup-task-status-slot" aria-live="polite">
            <Pill pillStyle={pillStyle} size="small">
              {statusLabel}
            </Pill>
            <span className="backup-task-status__message">{message}</span>
          </div>
        )}
      </div>

      {dangerConfirm ? (
        <dialog
          ref={dangerDialogRef}
          className="backup-confirm-dialog backup-confirm-dialog--danger-confirm"
          onMouseDown={(e) => closeNativeDialogOnBackdropPointer(e, dangerDialogRef)}
        >
          <p className="backup-confirm-dialog__title">{dangerConfirm.title}</p>
          <p className="backup-confirm-dialog__body">{dangerConfirm.body}</p>
          <div className="backup-confirm-dialog__actions">
            <Button buttonStyle="error" size="small" onClick={() => void handleDangerConfirm()}>
              {dangerConfirm.confirmLabel ?? 'I understand — continue'}
            </Button>
            <Button
              buttonStyle="secondary"
              size="small"
              onClick={() => dangerDialogRef.current?.close()}
            >
              {dangerConfirm.cancelLabel ?? 'Go back'}
            </Button>
          </div>
        </dialog>
      ) : null}
    </>
  )
}
