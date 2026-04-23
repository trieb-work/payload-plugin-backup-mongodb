'use client'

import { useRef } from 'react'

import { Button } from '@payloadcms/ui'

import { backupPluginPublicApiPaths } from '../../publicApiPaths.js'
import { closeNativeDialogOnBackdropPointer } from '../../utils/dialogBackdrop.js'

import { RestoreBackupDialog } from './RestoreBackupDialog.client.js'
import { TaskActionButton } from './TaskActionButton.client.js'

type BackupItemActionsProps = {
  downloadUrl: string
  pathname: string
  url: string
}

export const BackupItemActions: React.FC<BackupItemActionsProps> = ({
  downloadUrl,
  pathname,
  url,
}) => {
  const downloadParams = new URLSearchParams({ pathname })
  if (url) downloadParams.set('url', url)
  if (downloadUrl) downloadParams.set('downloadUrl', downloadUrl)
  const downloadHref = `${backupPluginPublicApiPaths.adminBackupDownload}?${downloadParams.toString()}`
  const deleteDialogRef = useRef<HTMLDialogElement>(null)

  return (
    <div className="backup-item-actions">
      <div className="backup-item-actions__buttons">
        <Button buttonStyle="secondary" el="anchor" newTab size="small" url={downloadHref}>
          Download
        </Button>
        <RestoreBackupDialog downloadUrl={downloadUrl} pathname={pathname} />
        <Button
          buttonStyle="secondary"
          size="small"
          onClick={() => deleteDialogRef.current?.showModal()}
        >
          Delete
        </Button>
      </div>

      <dialog
        ref={deleteDialogRef}
        className="backup-confirm-dialog"
        onMouseDown={(e) => closeNativeDialogOnBackdropPointer(e, deleteDialogRef)}
      >
        <p className="backup-confirm-dialog__title">Delete this backup?</p>
        <p className="backup-confirm-dialog__body">This action cannot be undone.</p>
        <div className="backup-confirm-dialog__actions">
          <TaskActionButton
            body={{ pathname, url }}
            buttonStyle="error"
            completeLabel="Deleted"
            endpoint={backupPluginPublicApiPaths.adminDelete}
            idleLabel="Yes, delete"
            kind="delete"
            pendingLabel="Deleting..."
            refreshOnComplete={true}
          />
          <Button
            buttonStyle="secondary"
            size="small"
            onClick={() => deleteDialogRef.current?.close()}
          >
            Cancel
          </Button>
        </div>
      </dialog>
    </div>
  )
}
