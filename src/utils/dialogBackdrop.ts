import type { MouseEvent, PointerEvent, RefObject } from 'react'

/** Mouse or pointer event with viewport coordinates (native {@code <dialog>} backdrop close). */
export type DialogBackdropPointer =
  | Pick<MouseEvent<HTMLDialogElement>, 'clientX' | 'clientY'>
  | Pick<PointerEvent<HTMLDialogElement>, 'clientX' | 'clientY'>

/**
 * Closes a native {@code <dialog>} when the pointer event is outside the dialog panel
 * (on the dimmed backdrop). Modal dialogs only expose the panel in {@code getBoundingClientRect()},
 * not the full viewport overlay.
 */
export function closeNativeDialogOnBackdropPointer(
  event: DialogBackdropPointer,
  dialogRef: RefObject<HTMLDialogElement | null>,
): void {
  const el = dialogRef.current
  if (!el) {return}
  const r = el.getBoundingClientRect()
  const { clientX: x, clientY: y } = event
  if (x < r.left || x > r.right || y < r.top || y > r.bottom) {
    el.close()
  }
}
