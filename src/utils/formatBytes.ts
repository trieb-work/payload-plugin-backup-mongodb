/** Human-readable file size (binary units: KiB, MiB, GiB — shown as KB/MB/GB for familiarity). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '—'
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`
  }
  const kb = bytes / 1024
  if (kb < 1024) {
    return kb < 10 ? `${kb.toFixed(1)} KB` : `${Math.round(kb)} KB`
  }
  const mb = kb / 1024
  if (mb < 1024) {
    return mb < 10 ? `${mb.toFixed(1)} MB` : `${mb.toFixed(1)} MB`
  }
  const gb = mb / 1024
  return gb < 10 ? `${gb.toFixed(2)} GB` : `${gb.toFixed(1)} GB`
}
