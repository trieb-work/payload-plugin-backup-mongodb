'use client'

import { Button } from '@payloadcms/ui'
import { useRef } from 'react'

import { backupPluginPublicApiPaths } from '../../publicApiPaths'
import { closeNativeDialogOnBackdropPointer } from '../../utils/dialogBackdrop'
import { RestoreBackupDialog } from './RestoreBackupDialog.client'
import { TaskActionButton } from './TaskActionButton.client'

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
  if (url) {
    downloadParams.set('url', url)
  }
  if (downloadUrl) {
    downloadParams.set('downloadUrl', downloadUrl)
  }
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
          onClick={() => deleteDialogRef.current?.showModal()}
          size="small"
        >
          Delete
        </Button>
      </div>

      {/* Native <dialog>: backdrop dismiss; element not in jsx-a11y interactive list */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <dialog
        className="backup-confirm-dialog"
        onMouseDown={(e) => closeNativeDialogOnBackdropPointer(e, deleteDialogRef)}
        ref={deleteDialogRef}
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
            onClick={() => deleteDialogRef.current?.close()}
            size="small"
          >
            Cancel
          </Button>
        </div>
      </dialog>
    </div>
  )
}
