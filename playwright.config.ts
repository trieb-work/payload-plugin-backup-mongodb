import { defineConfig, devices } from '@playwright/test'
import dotenv from 'dotenv'

dotenv.config({ override: false, path: 'dev/.env.local' })
dotenv.config({ override: false, path: 'dev/.env' })

const isCI = Boolean(process.env.CI)
const port = Number(process.env.PLAYWRIGHT_PORT || '3000')
const baseURL = process.env.PLAYWRIGHT_BASE_URL?.replace(/\/$/, '') || `http://localhost:${port}`

const webServerCommand = `cross-env NODE_ENV=test NODE_OPTIONS=--no-deprecation PAYLOAD_CONFIG_PATH=./dev/payload.config.ts pnpm exec next start dev -p ${port}`

export default defineConfig({
  forbidOnly: isCI,
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  reporter:
    isCI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  retries: isCI ? 2 : 0,
  testDir: './tests/e2e',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  webServer: {
    command: webServerCommand,
    // Local: reuse a manually started `pnpm dev` when the admin URL is already up.
    reuseExistingServer: !isCI,
    timeout: 240_000,
    url: `${baseURL}/admin`,
  },
  workers: isCI ? 1 : undefined,
})
