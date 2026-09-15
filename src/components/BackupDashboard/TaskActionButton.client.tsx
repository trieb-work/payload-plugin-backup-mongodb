'use client'

import { Button, Pill } from '@payloadcms/ui'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { BackupTaskProgress } from '../../core/taskProgress'

import { backupPluginPublicApiPaths } from '../../publicApiPaths'
import { closeNativeDialogOnBackdropPointer } from '../../utils/dialogBackdrop'

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
  /** Invoked once when the task reaches a successful terminal state (`completed` or `completed_with_warnings`). */
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
  const intervalRef = useRef<null | ReturnType<typeof setInterval>>(null)
  /** Avoid firing `onComplete` twice if the polling effect re-runs while status stays `completed`. */
  const completeNotifyForTaskIdRef = useRef<null | string>(null)
  /** Lets the task GET succeed after restore replaces `users` (session becomes invalid). */
  const pollSecretRef = useRef<null | string>(null)
  const [error, setError] = useState<null | string>(null)
  const [isStarting, setIsStarting] = useState(false)
  const [task, setTask] = useState<BackupTaskProgress | null>(null)

  const isBusy = isStarting || task?.status === 'queued' || task?.status === 'running'
  const isDoneWithWarnings = task?.status === 'completed_with_warnings'
  const message = error || task?.message || ''
  const warnings = !error && task?.warnings ? task.warnings : ''

  const isTerminal =
    task?.status === 'completed' ||
    task?.status === 'completed_with_warnings' ||
    task?.status === 'failed'

  const label = useMemo(() => {
    if (isBusy) {
      return pendingLabel
    }

    if (task?.status === 'completed' || task?.status === 'completed_with_warnings') {
      return completeLabel
    }

    return idleLabel
  }, [completeLabel, idleLabel, isBusy, pendingLabel, task?.status])

  const pillStyle = useMemo(() => {
    if (error || task?.status === 'failed') {
      return 'error' as const
    }

    if (isDoneWithWarnings) {
      return 'warning' as const
    }

    if (task?.status === 'completed') {
      return 'success' as const
    }

    if (isBusy || task?.status === 'queued' || task?.status === 'running') {
      return 'warning' as const
    }

    return 'light-gray' as const
  }, [error, isBusy, isDoneWithWarnings, task?.status])

  const statusLabel = useMemo(() => {
    if (error || task?.status === 'failed') {
      return 'Failed'
    }

    if (isDoneWithWarnings) {
      return 'Done with warnings'
    }

    if (task?.status === 'completed') {
      return 'Done'
    }

    if (isBusy || task?.status === 'queued' || task?.status === 'running') {
      return 'Working'
    }

    return 'Idle'
  }, [error, isBusy, isDoneWithWarnings, task?.status])

  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!task?.id || !isTerminal) {
      return
    }

    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }

    if (task.status === 'completed' || task.status === 'completed_with_warnings') {
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
  }, [
    isTerminal,
    onComplete,
    redirectOnComplete,
    refreshOnComplete,
    router,
    task?.id,
    task?.status,
  ])

  useEffect(() => {
    if (!task?.id || isTerminal) {
      return
    }

    intervalRef.current = setInterval(async () => {
      const response = await fetch(backupPluginPublicApiPaths.adminTask(task.id), {
        cache: 'no-store',
        ...(pollSecretRef.current ?
          { headers: { Authorization: `Bearer ${pollSecretRef.current}` } }
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
  }, [isTerminal, task?.id])

  const runTask = async () => {
    try {
      setError(null)
      setIsStarting(true)
      pollSecretRef.current = null
      completeNotifyForTaskIdRef.current = null
      setTask(null)

      const response = await fetch(endpoint, {
        body: JSON.stringify(body ?? {}),
        headers: {
          'Content-Type': 'application/json',
        },
        method: 'POST',
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(text || 'Request failed')
      }

      const data = (await response.json()) as { pollSecret?: string; taskId: string }
      pollSecretRef.current = data.pollSecret ?? null
      const now = new Date().toISOString()
      setTask({
        id: data.taskId,
        createdAt: now,
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
          onClick={() => void handlePrimaryClick()}
          size="medium"
        >
          {label}
        </Button>

        {(task !== null || error !== null) && (
          <div aria-live="polite" className="backup-task-status-slot">
            <Pill pillStyle={pillStyle} size="small">
              {statusLabel}
            </Pill>
            <div className="backup-task-status__details">
              {message ?
                <span className="backup-task-status__message">{message}</span>
              : null}
              {warnings ?
                <span className="backup-task-status__warnings">{warnings}</span>
              : null}
              {task?.error && task.status === 'failed' ?
                <span className="backup-task-status__error">{task.error}</span>
              : null}
            </div>
          </div>
        )}
      </div>

      {dangerConfirm ?
        <>
          {/* Native <dialog>: backdrop dismiss; element not in jsx-a11y interactive list */}
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
          <dialog
            className="backup-confirm-dialog backup-confirm-dialog--danger-confirm"
            onMouseDown={(e) => closeNativeDialogOnBackdropPointer(e, dangerDialogRef)}
            ref={dangerDialogRef}
          >
            <p className="backup-confirm-dialog__title">{dangerConfirm.title}</p>
            <p className="backup-confirm-dialog__body">{dangerConfirm.body}</p>
            <div className="backup-confirm-dialog__actions">
              <Button buttonStyle="error" onClick={() => void handleDangerConfirm()} size="small">
                {dangerConfirm.confirmLabel ?? 'I understand — continue'}
              </Button>
              <Button
                buttonStyle="secondary"
                onClick={() => dangerDialogRef.current?.close()}
                size="small"
              >
                {dangerConfirm.cancelLabel ?? 'Go back'}
              </Button>
            </div>
          </dialog>
        </>
      : null}
    </>
  )
}
