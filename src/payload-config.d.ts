/**
 * Ambient declaration for the `@payload-config` alias that Next.js sets up in every
 * Payload v3 project. Consumers must already have this alias configured (it is part
 * of the standard Payload project scaffolding).
 */
declare module '@payload-config' {
  import type { SanitizedConfig } from 'payload'
  const config: Promise<SanitizedConfig>
  export default config
}
