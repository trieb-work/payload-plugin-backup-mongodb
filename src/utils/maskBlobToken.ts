/**
 * Mask a Vercel Blob read/write token for display in the admin UI (never send the full secret).
 * Shape: prefix + fixed-length asterisk run + suffix (length of real token does not change star count).
 * Example: vercel_blob_rw_yfn + 23×* + bsM7
 */
export function maskBlobReadWriteToken(raw: string): string {
  const t = raw.trim()
  if (t.length === 0) {return ''}

  /** Fixed number of asterisks between prefix and suffix (UI stays compact for any token length). */
  const middleRun = 32

  const prefixLen = Math.min(18, Math.max(8, Math.floor(t.length * 0.42)))
  const suffixLen = Math.min(4, Math.max(3, Math.floor(t.length * 0.12)))

  if (t.length <= prefixLen + suffixLen + 6) {
    const headLen = Math.min(6, t.length)
    const head = t.slice(0, headLen)
    const tailLen = Math.min(3, Math.max(0, t.length - headLen))
    const tail = tailLen > 0 ? t.slice(-tailLen) : ''
    const middle = '*'.repeat(middleRun)
    return tail ? `${head}${middle}${tail}` : `${head}${middle}`
  }

  const prefix = t.slice(0, prefixLen)
  const suffix = t.slice(-suffixLen)
  return `${prefix}${'*'.repeat(middleRun)}${suffix}`
}

/**
 * When a token is already stored, treat the client value as "do not change the stored token" if
 * they left the masked placeholder or cleared the field while editing other settings.
 */
export function shouldPreserveBackupBlobTokenField(
  clientValue: string,
  hadStoredToken: boolean,
): boolean {
  if (!hadStoredToken) {return false}
  const v = clientValue.trim()
  if (v.length === 0) {return true}
  if (/\*{2,}/.test(v)) {return true}
  return false
}
